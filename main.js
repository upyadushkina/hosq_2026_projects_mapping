// Global state
let nodes = [];
let links = [];
let simulation = null;
let svg = null;
let g = null;
let nodeElements = null;
let nodeGroups = null;
let linkElements = null;
let backgroundColumns = null;
let selectedTypes = new Set();
let selectedFields = new Set();
const fieldFilterElements = new Map();
let searchQuery = '';
let clickedNode = null; // Track clicked node to keep popup visible
let hoveredNode = null; // Track hovered node for popup updates

// Schedule order for left-to-right positioning
const SCHEDULE_ORDER = ['Winter', 'Spring', 'Summer', 'Fall'];

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Load and parse CSV data
 */
async function loadData() {
  try {
    const data = await d3.csv('projects_dataset.csv');
    return normalizeData(data);
  } catch (error) {
    console.error('Error loading CSV:', error);
    return { nodes: [], links: [] };
  }
}

/**
 * Normalize CSV data into nodes and links
 */
function normalizeData(csvData) {
  // Create a map of project names to nodes for link creation
  const projectMap = new Map();
  
  // Build nodes array
  nodes = csvData.map(row => {
    // Parse fields (comma-separated, trim whitespace)
    const fields = row.fields
      ? row.fields.split(',').map(f => f.trim()).filter(f => f.length > 0)
      : [];
    
    // Parse schedule (comma-separated, trim whitespace)
    const schedule = row.schedule
      ? row.schedule.split(',').map(s => s.trim()).filter(s => s.length > 0)
      : [];
    
    // Parse connected projects (comma-separated, trim, remove empty)
    const connectedProjects = row['connected projects']
      ? row['connected projects'].split(',').map(p => p.trim()).filter(p => p.length > 0)
      : [];
    
    // Convert scale to number
    const scale = parseFloat(row.scale) || 1;
    
    // Convert Google Drive link to direct image URL if needed
    let photoLink = row['photo link'] || '';
    if (photoLink && photoLink.trim() !== '') {
      // Convert Google Drive view link to thumbnail URL
      if (photoLink.includes('drive.google.com') && photoLink.includes('/d/')) {
        const parts = photoLink.split('/d/');
        if (parts.length > 1) {
          const fileId = parts[1].split('/')[0].split('?')[0]; // Get file ID, remove query params
          photoLink = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
        }
      }
    }
    
    // Create node object
    const node = {
      id: row['project name'],
      name: row['project name'],
      type: row.type || '',
      fields: fields,
      schedule: schedule,
      color: row.color || '#E673C8',
      scale: scale,
      description: row.description || '',
      previousEvent: row['previous event'] || '',
      photoLink: photoLink,
      connectedProjects: connectedProjects
    };
    
    projectMap.set(node.id, node);
    return node;
  });
  
  // Build links array
  links = [];
  const linkSet = new Set(); // To avoid duplicates
  
  nodes.forEach(node => {
    node.connectedProjects.forEach(connectedName => {
      const targetNode = projectMap.get(connectedName);
      if (targetNode && targetNode.id !== node.id) {
        // Create unique link identifier
        const linkId = [node.id, targetNode.id].sort().join('|');
        if (!linkSet.has(linkId)) {
          linkSet.add(linkId);
          links.push({
            source: node.id,
            target: targetNode.id
          });
        }
      }
    });
  });
  
  return { nodes, links };
}

/**
 * Create X position scale based on schedule
 */
function createScheduleScale(width) {
  return d3.scalePoint()
    .domain(SCHEDULE_ORDER)
    .range([width * 0.15, width * 0.85])
    .padding(0.5);
}

/**
 * Get X position for a node based on its schedule
 */
function getNodeXPosition(node, scheduleScale) {
  // If node has multiple schedules, use the first one
  // Or calculate average position
  if (node.schedule.length === 0) {
    return scheduleScale.range()[1] / 2; // Default to middle
  }
  
  // Use the first schedule value, or average if multiple
  const firstSchedule = node.schedule[0];
  return scheduleScale(firstSchedule) || scheduleScale.range()[1] / 2;
}

/**
 * Get phone view scale factor (0.8 for phone, 1.0 for desktop)
 */
function getPhoneViewScale() {
  const isPhoneView = window.innerWidth <= 768;
  return isPhoneView ? 0.8 : 1.0;
}

/**
 * Calculate node radius based on scale value
 * Uses different formula for phone view (max-width: 768px)
 * Also applies 0.6 scale factor for phone view
 */
function getNodeRadius(scale) {
  const isPhoneView = window.innerWidth <= 768;
  const phoneScale = getPhoneViewScale();
  let radius;
  if (isPhoneView) {
    radius = 10 + scale * 2;
  } else {
    radius = 5 + scale * 3.7;
  }
  return radius * phoneScale;
}

/**
 * Initialize the visualization
 */
function initVisualization(data) {
  const container = d3.select('.content');
  const containerNode = container.node();
  const width = containerNode.clientWidth;
  const height = containerNode.clientHeight;
  
  // Create SVG
  svg = d3.select('#visualization')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);
  
  // Create main group for zoom/pan
  g = svg.append('g');
  
  // Create schedule scale
  const scheduleScale = createScheduleScale(width);
  
  // Create force simulation
  simulation = d3.forceSimulation(data.nodes)
    .force('link', d3.forceLink(data.links)
      .id(d => d.id)
      .distance(100)
    )
    .force('charge', d3.forceManyBody().strength(-300))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('x', d3.forceX(d => getNodeXPosition(d, scheduleScale)).strength(0.5))
    .force('y', d3.forceY(height / 2).strength(0.1));
  
  // Add zoom behavior
  const zoom = d3.zoom()
    .scaleExtent([0.3, 4])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });
  
  svg.call(zoom);
  
  // Create defs for clipPaths
  const defs = svg.append('defs');
  
  // Create background columns for schedule
  backgroundColumns = g.append('g')
    .attr('class', 'background-columns');
  
  // Divide the full width into 4 equal columns
  const columnWidth = width / SCHEDULE_ORDER.length;
  
  // Create 4 columns with separators and labels
  SCHEDULE_ORDER.forEach((season, i) => {
    const x = i * columnWidth;
    const nextX = (i + 1) * columnWidth;
    const columnCenterX = x + columnWidth / 2;
    
    // Create column rectangle (subtle background, optional)
    backgroundColumns.append('rect')
      .attr('x', x)
      .attr('y', 0)
      .attr('width', columnWidth)
      .attr('height', height)
      .attr('fill', 'none')
      .attr('stroke', 'none');
    
    // Add label at the top center of each column
    const phoneScale = getPhoneViewScale();
    backgroundColumns.append('text')
      .attr('x', columnCenterX)
      .attr('y', 20)
      .attr('text-anchor', 'middle')
      .attr('fill', '#4C4646')
      .attr('font-size', `${14 * phoneScale}px`)
      .attr('font-family', 'Lexend-Medium')
      .attr('pointer-events', 'none')
      .text(season);
    
    // Add vertical separator line (except for the last column)
    if (i < SCHEDULE_ORDER.length - 1) {
      backgroundColumns.append('line')
        .attr('x1', nextX)
        .attr('y1', 0)
        .attr('x2', nextX)
        .attr('y2', height)
        .attr('stroke', '#4C4646')
        .attr('stroke-width', 1 * phoneScale)
        .attr('stroke-opacity', 0.3)
        .attr('pointer-events', 'none');
    }
  });
  
  // Draw links
  linkElements = g.append('g')
    .attr('class', 'links')
    .selectAll('line')
    .data(data.links)
    .enter()
    .append('line')
    .attr('class', 'link')
    .attr('stroke', '#4C4646')
    .attr('stroke-width', 1.5);
  
  // Create node groups (circle + image)
  nodeGroups = g.append('g')
    .attr('class', 'nodes')
    .selectAll('g')
    .data(data.nodes)
    .enter()
    .append('g')
    .attr('class', 'node-group')
    .call(d3.drag()
      .on('start', dragStarted)
      .on('drag', dragged)
      .on('end', dragEnded)
    )
    .on('mouseover', handleNodeHover)
    .on('mouseout', handleNodeMouseOut)
    .on('click', handleNodeClick);
  
  // For each node, create a clipPath if it has a photo
  data.nodes.forEach((node, i) => {
    if (node.photoLink && node.photoLink.trim() !== '') {
      const clipId = `node-clip-${i}`;
      node.clipId = clipId;

      const clipPath = defs.append('clipPath')
        .attr('id', clipId);

      clipPath.append('circle')
        .attr('cx', 0)
        .attr('cy', 0)
        .attr('r', getNodeRadius(node.scale));
    }
  });
  
  // Create circles for nodes (background/fill) - no stroke
  nodeElements = nodeGroups.append('circle')
    .attr('class', 'node')
    .attr('r', d => getNodeRadius(d.scale))
    .attr('fill', d => d.color)
    .attr('stroke', 'none');

  // Add images inside circles for nodes with photos
  nodeGroups.filter(d => d.clipId).append('image')
    .attr('href', d => d.photoLink)
    .attr('xlink:href', d => d.photoLink)
    .attr('x', d => -getNodeRadius(d.scale))
    .attr('y', d => -getNodeRadius(d.scale))
    .attr('width', d => getNodeRadius(d.scale) * 2)
    .attr('height', d => getNodeRadius(d.scale) * 2)
    .attr('preserveAspectRatio', 'xMidYMid slice')
    .attr('clip-path', d => `url(#${d.clipId})`);
  
  // Add labels (project names) to all nodes
  const phoneScale = getPhoneViewScale();
  const nodeLabels = nodeGroups.append('text')
    .attr('class', 'node-label')
    .text(d => d.name)
    .attr('font-size', 10 * phoneScale)
    .attr('text-anchor', 'middle')
    .attr('dy', d => getNodeRadius(d.scale) + 14 * phoneScale) // Position below the circle
    .attr('fill', '#E8DED3')
    .attr('pointer-events', 'none')
    .style('font-family', 'Lexend-Medium');
  
  // Store labels reference for opacity updates
  window.nodeLabels = nodeLabels;
  
  // Update positions on simulation tick
  simulation.on('tick', () => {
    linkElements
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);
    
    nodeGroups
      .attr('transform', d => `translate(${d.x},${d.y})`);
    
    // Update popup position if a node is clicked or hovered
    const nodeToUpdate = clickedNode || hoveredNode;
    if (nodeToUpdate) {
      updatePopupPosition(nodeToUpdate);
    }
  });
  
  // Handle click on background to close popup
  svg.on('click', function(event) {
    // Check if click originated from popup
    const popup = document.getElementById('popup');
    if (popup && popup.style.display === 'block') {
      const path = event.composedPath ? event.composedPath() : (event.path || []);
      if (path.some(el => el === popup || (el && el.classList && el.classList.contains('popup')))) {
        return;
      }
    }
    
    // Only close if clicking on background (not on a node or popup)
    if (event.target === svg.node() || event.target === g.node()) {
      clickedNode = null;
      hoveredNode = null;
      hidePopup();
    }
  });
  
  // Handle clicks/touches outside popup to close it (for mobile and desktop)
  // Use a single handler that checks the event path more carefully
  const handleOutsideClick = function(event) {
    const popup = document.getElementById('popup');
    if (!popup || popup.style.display !== 'block') return;
    
    // Check event path/composedPath first - this is most reliable for mobile
    const path = event.composedPath ? event.composedPath() : (event.path || []);
    
    // If any element in the path is the popup or inside it, don't close
    for (let i = 0; i < path.length; i++) {
      const el = path[i];
      if (!el) continue;
      
      // Check if it's the popup itself
      if (el === popup || el.id === 'popup') {
        return;
      }
      
      // Check if it has popup classes
      if (el.classList) {
        if (el.classList.contains('popup') || 
            el.classList.contains('popup-tag') || 
            el.classList.contains('popup-button') ||
            el.classList.contains('popup-name') ||
            el.classList.contains('popup-type') ||
            el.classList.contains('popup-description') ||
            el.classList.contains('popup-tags') ||
            el.classList.contains('popup-photo')) {
          return;
        }
      }
      
      // Check if it's inside the popup
      if (el.nodeType === 1 && popup.contains(el)) {
        return;
      }
    }
    
    const target = event.target;
    
    // Double-check with contains
    if (popup.contains(target)) {
      return;
    }
    
    // Don't close if clicking on a node
    if (target.closest('.node-group') || 
        target.classList.contains('node') ||
        target.closest('circle') ||
        target.closest('image') ||
        target.closest('text')) {
      return;
    }
    
    // Don't close if clicking on buttons
    if (target.closest('.top-btn') || 
        target.closest('#filters-popup') ||
        target.closest('#filters-backdrop')) {
      return;
    }
    
    // Close popup if clicking outside
    clickedNode = null;
    hoveredNode = null;
    hidePopup();
  };
  
  // Use capture phase and handle both click and touch
  // Use a small delay for touchend to allow popup handlers to run first
  document.addEventListener('click', handleOutsideClick, true);
  document.addEventListener('touchend', function(e) {
    // Small delay to let popup handlers process first
    setTimeout(() => handleOutsideClick(e), 10);
  }, true);
}

/**
 * Drag handlers
 */
function dragStarted(event, d) {
  if (!event.active) simulation.alphaTarget(0.3).restart();
  d.fx = d.x;
  d.fy = d.y;
}

function dragged(event, d) {
  d.fx = event.x;
  d.fy = event.y;
}

function dragEnded(event, d) {
  if (!event.active) simulation.alphaTarget(0);
  d.fx = null;
  d.fy = null;
}

/**
 * Handle node hover
 */
function handleNodeHover(event, d) {
  // Don't show popup on hover if a node is already clicked (unless it's the same node)
  if (clickedNode && clickedNode.id !== d.id) {
    return;
  }
  
  hoveredNode = d;
  
  // Get connected neighbor IDs
  const connectedIds = new Set([d.id]);
  linkElements.each(function(l) {
    const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
    const targetId = typeof l.target === 'object' ? l.target.id : l.target;
    if (sourceId === d.id) connectedIds.add(targetId);
    if (targetId === d.id) connectedIds.add(sourceId);
  });
  
  // Create a map of node opacity values
  const nodeOpacityMap = new Map();
  nodeGroups.each(function(n) {
    let opacity = 1;
    if (n.id === d.id) {
      opacity = 1;
    } else if (connectedIds.has(n.id)) {
      opacity = 1; // Keep connected neighbors fully opaque
    } else if (n.type === d.type) {
      opacity = 1;
    } else {
      opacity = 0.15; // Stronger opacity reduction for non-matching types
    }
    nodeOpacityMap.set(n.id, opacity);
  });
  
  // Highlight edges connected to this node
  linkElements
    .classed('highlighted', l => {
      const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
      const targetId = typeof l.target === 'object' ? l.target.id : l.target;
      return sourceId === d.id || targetId === d.id;
    })
    .attr('stroke-opacity', l => {
      const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
      const targetId = typeof l.target === 'object' ? l.target.id : l.target;
      const isConnected = sourceId === d.id || targetId === d.id;
      if (isConnected) {
        return 1; // Fully visible for connected edges
      }
      // For non-connected edges, dim if either node is dimmed
      const sourceOpacity = nodeOpacityMap.get(sourceId) || 1;
      const targetOpacity = nodeOpacityMap.get(targetId) || 1;
      return Math.min(sourceOpacity, targetOpacity);
    });
  
  // Reduce opacity of nodes with different type, but keep connected neighbors fully opaque
  // Apply opacity to the entire node group (circle, image, text)
  nodeGroups.attr('opacity', n => nodeOpacityMap.get(n.id) || 1);
  
  // Show popup on hover (only if no node is clicked, or if hovering the clicked node)
  if (!clickedNode || clickedNode.id === d.id) {
    showPopup(d);
  }
}

/**
 * Handle node mouse out
 */
function handleNodeMouseOut(event, d) {
  hoveredNode = null;
  
  // If a node is clicked, keep popup visible even on mouseout
  if (clickedNode && clickedNode.id === d.id) {
    // Keep popup visible for clicked node, but reset link/node opacity
    linkElements
      .classed('highlighted', false)
      .attr('stroke-opacity', 0.6);
    applyFilters();
    return;
  }
  
  // Reset all links
  linkElements
    .classed('highlighted', false)
    .attr('stroke-opacity', 0.6);
  
  // Reset all node opacities (but respect filter state)
  applyFilters();
  
  // Hide popup if not clicked (only hide if no node is clicked)
  if (!clickedNode) {
    hidePopup();
  }
}

/**
 * Handle node click
 */
function handleNodeClick(event, d) {
  event.stopPropagation();
  clickedNode = d;
  
  // Get connected neighbor IDs
  const connectedIds = new Set([d.id]);
  linkElements.each(function(l) {
    const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
    const targetId = typeof l.target === 'object' ? l.target.id : l.target;
    if (sourceId === d.id) connectedIds.add(targetId);
    if (targetId === d.id) connectedIds.add(sourceId);
  });
  
  // Create a map of node opacity values
  const nodeOpacityMap = new Map();
  nodeGroups.each(function(n) {
    let opacity = 1;
    if (n.id === d.id) {
      opacity = 1;
    } else if (connectedIds.has(n.id)) {
      opacity = 1; // Keep connected neighbors fully opaque
    } else {
      opacity = 0.15; // Dim all other nodes
    }
    nodeOpacityMap.set(n.id, opacity);
  });
  
  // Highlight edges connected to this node
  linkElements
    .classed('highlighted', l => {
      const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
      const targetId = typeof l.target === 'object' ? l.target.id : l.target;
      return sourceId === d.id || targetId === d.id;
    })
    .attr('stroke-opacity', l => {
      const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
      const targetId = typeof l.target === 'object' ? l.target.id : l.target;
      const isConnected = sourceId === d.id || targetId === d.id;
      if (isConnected) {
        return 1; // Fully visible for connected edges
      }
      // For non-connected edges, dim if either node is dimmed
      const sourceOpacity = nodeOpacityMap.get(sourceId) || 1;
      const targetOpacity = nodeOpacityMap.get(targetId) || 1;
      return Math.min(sourceOpacity, targetOpacity);
    });
  
  // Keep clicked node and connected neighbors fully opaque
  nodeGroups.attr('opacity', n => nodeOpacityMap.get(n.id) || 1);
  
  showPopup(d);
}

/**
 * Show popup with project information
 */
function showPopup(node) {
  const popup = document.getElementById('popup');
  if (!popup) return;
  
  let html = '';
  
  // Photo (if available) - always show if photo link exists
  if (node.photoLink && node.photoLink.trim() !== '') {
    html += `<img src="${node.photoLink}" alt="${node.name}" class="popup-photo" onerror="this.style.display='none'">`;
  }
  
  // Project name
  html += `<div class="popup-name">${node.name}</div>`;
  
  // Type | Schedule (in smaller text, color #4C4646)
  const scheduleDisplay = node.schedule && node.schedule.length > 0 ? node.schedule[0] : '';
  const typeScheduleText = scheduleDisplay ? `${node.type} | ${scheduleDisplay}` : node.type;
  html += `<div class="popup-type">${typeScheduleText}</div>`;
  
  // Description - always show if it exists
  if (node.description && node.description.trim() !== '') {
    html += `<div class="popup-description">${node.description}</div>`;
  }
  
  // Fields (as tags)
  if (node.fields && node.fields.length > 0) {
    html += `<div class="popup-tags">`;
    node.fields.forEach(field => {
      const safeField = escapeHtml(field);
      const isActiveField = selectedFields.has(field);
      const activeClass = isActiveField ? ' active' : '';
      html += `<button type="button" class="popup-tag${activeClass}" data-field="${safeField}">${safeField}</button>`;
    });
    html += `</div>`;
  }
  
  // Previous event button
  if (node.previousEvent && node.previousEvent.trim() !== '') {
    html += `<a href="${node.previousEvent}" target="_blank" class="popup-button">${node.name} in 2025</a>`;
  }
  
  popup.innerHTML = html;
  popup.style.display = 'block';
  
  // Store touch timestamp to prevent synthetic clicks from closing popup
  let lastTouchTime = 0;
  
  // Handle touchstart - just stop propagation and record time
  const popupTouchStartHandler = (event) => {
    event.stopPropagation();
    lastTouchTime = Date.now();
  };
  
  // Handle touchend - process the action
  const popupTouchEndHandler = (event) => {
    event.stopPropagation();
    lastTouchTime = Date.now();
    
    const target = event.target;
    
    // Handle popup tag touches
    if (target.classList.contains('popup-tag')) {
      event.preventDefault();
      const fieldValue = target.getAttribute('data-field');
      if (fieldValue) {
        toggleFieldFilter(fieldValue);
        const isActiveNow = selectedFields.has(fieldValue);
        target.classList.toggle('active', isActiveNow);
      }
    }
    // For popup button, don't prevent default - let link work
  };
  
  // Handle click events on popup
  const popupClickHandler = (event) => {
    // On mobile, ignore synthetic clicks that happen shortly after touch
    const timeSinceTouch = Date.now() - lastTouchTime;
    if (timeSinceTouch < 500) {
      if (event.target.classList.contains('popup-tag')) {
        event.preventDefault();
      }
      event.stopPropagation();
      return;
    }
    
    event.stopPropagation();
    
    const target = event.target;
    
    // Handle popup tag clicks
    if (target.classList.contains('popup-tag')) {
      event.preventDefault();
      const fieldValue = target.getAttribute('data-field');
      if (fieldValue) {
        toggleFieldFilter(fieldValue);
        const isActiveNow = selectedFields.has(fieldValue);
        target.classList.toggle('active', isActiveNow);
      }
    }
    // For popup button, let link navigate normally
  };
  
  // Add handlers with capture phase to catch events early
  popup.addEventListener('touchstart', popupTouchStartHandler, { capture: true, passive: false });
  popup.addEventListener('touchend', popupTouchEndHandler, { capture: true, passive: false });
  popup.addEventListener('click', popupClickHandler, { capture: true });
  popup.addEventListener('mousedown', (e) => e.stopPropagation(), { capture: true });
  
  // Position popup near the node
  updatePopupPosition(node);
}

/**
 * Update popup position based on node location
 */
function updatePopupPosition(node) {
  const popup = document.getElementById('popup');
  if (!popup || !svg || popup.style.display !== 'block') return;
  
  const transform = d3.zoomTransform(svg.node());
  const x = node.x * transform.k + transform.x;
  const y = node.y * transform.k + transform.y;
  
  // Position popup to the right and slightly below the node (like in example)
  popup.style.left = (x + 15) + 'px';
  popup.style.top = (y + 15) + 'px';
}

/**
 * Hide popup
 */
function hidePopup() {
  const popup = document.getElementById('popup');
  if (popup) {
    popup.style.display = 'none';
  }
}

/**
 * Build filter UI
 */
function buildFilters() {
  // Get all unique types and fields
  const allTypes = new Set();
  const allFields = new Set();
  
  nodes.forEach(node => {
    if (node.type) allTypes.add(node.type);
    node.fields.forEach(field => allFields.add(field));
  });
  
  // Build type filters
  const typeContainer = d3.select('#type-filters');
  typeContainer.selectAll('*').remove();
  
  Array.from(allTypes).sort().forEach(type => {
    const tag = typeContainer.append('div')
      .attr('class', 'filter-tag')
      .text(type)
      .on('click', function() {
        const isActive = d3.select(this).classed('active');
        d3.select(this).classed('active', !isActive);
        
        if (isActive) {
          selectedTypes.delete(type);
        } else {
          selectedTypes.add(type);
        }
        
        applyFilters();
      });
  });
  
  // Build fields filters
  const fieldsContainer = d3.select('#fields-filters');
  fieldsContainer.selectAll('*').remove();
  fieldFilterElements.clear();
  
  Array.from(allFields).sort().forEach(field => {
    const tag = fieldsContainer.append('div')
      .attr('class', 'filter-tag')
      .text(field)
      .classed('active', selectedFields.has(field))
      .attr('data-field-filter', field)
      .on('click', () => toggleFieldFilter(field));
    
    fieldFilterElements.set(field, tag);
  });
}

/**
 * Toggle a field filter from either sidebar or popup
 */
function toggleFieldFilter(field) {
  const shouldBecomeActive = !selectedFields.has(field);
  setFieldFilterState(field, shouldBecomeActive);
}

/**
 * Set a field filter to a specific active state
 */
function setFieldFilterState(field, shouldBeActive, options = {}) {
  const { apply = true } = options;
  const tag = fieldFilterElements.get(field);
  if (tag) {
    tag.classed('active', shouldBeActive);
  }
  if (shouldBeActive) {
    selectedFields.add(field);
  } else {
    selectedFields.delete(field);
  }
  if (apply) {
    applyFilters();
  }
}

/**
 * Apply filters to nodes
 */
function applyFilters() {
  if (!nodeGroups || !linkElements) return;
  
  // Create a map of node opacity values
  const nodeOpacityMap = new Map();
  nodeGroups.each(function(d) {
    let opacity = 1;
    // Check type filter
    if (selectedTypes.size > 0 && !selectedTypes.has(d.type)) {
      opacity = 0.15;
    }
    // Check fields filter
    else if (selectedFields.size > 0) {
      const hasMatchingField = d.fields.some(field => selectedFields.has(field));
      if (!hasMatchingField) {
        opacity = 0.15;
      }
    }
    // Check search query
    else if (searchQuery && !d.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      opacity = 0.15;
    }
    nodeOpacityMap.set(d.id, opacity);
  });
  
  // Apply opacity to the entire node group (circle, image, text) so all elements dim together
  nodeGroups.attr('opacity', d => nodeOpacityMap.get(d.id) || 1);
  
  // Apply opacity to edges - dim if either source or target node is dimmed
  linkElements.attr('stroke-opacity', l => {
    const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
    const targetId = typeof l.target === 'object' ? l.target.id : l.target;
    const sourceOpacity = nodeOpacityMap.get(sourceId) || 1;
    const targetOpacity = nodeOpacityMap.get(targetId) || 1;
    // If either node is dimmed, dim the edge
    return Math.min(sourceOpacity, targetOpacity);
  });
}

/**
 * Reset all filters
 */
function resetFilters() {
  selectedTypes.clear();
  selectedFields.clear();
  searchQuery = '';
  
  // Reset UI
  d3.selectAll('.filter-tag').classed('active', false);
  d3.select('#search-input').property('value', '');
  
  // Reapply filters (to show all nodes)
  applyFilters();
}

/**
 * Handle window resize
 */
function handleResize() {
  if (!svg || !simulation) return;
  
  const container = d3.select('.content').node();
  const width = container.clientWidth;
  const height = container.clientHeight;
  
  svg.attr('width', width).attr('height', height);
  
  // Update schedule scale and force positions
  const scheduleScale = createScheduleScale(width);
  simulation.force('x', d3.forceX(d => getNodeXPosition(d, scheduleScale)).strength(0.5));
  simulation.force('center', d3.forceCenter(width / 2, height / 2));
  simulation.force('y', d3.forceY(height / 2).strength(0.1));
  
  // Update background columns
  if (backgroundColumns) {
    backgroundColumns.selectAll('*').remove();
    
    // Divide the full width into 4 equal columns
    const columnWidth = width / SCHEDULE_ORDER.length;
    
    // Create 4 columns with separators and labels
    SCHEDULE_ORDER.forEach((season, i) => {
      const x = i * columnWidth;
      const nextX = (i + 1) * columnWidth;
      const columnCenterX = x + columnWidth / 2;
      
      // Create column rectangle (subtle background, optional)
      backgroundColumns.append('rect')
        .attr('x', x)
        .attr('y', 0)
        .attr('width', columnWidth)
        .attr('height', height)
        .attr('fill', 'none')
        .attr('stroke', 'none');
      
      // Add label at the top center of each column
      const phoneScale = getPhoneViewScale();
      backgroundColumns.append('text')
        .attr('x', columnCenterX)
        .attr('y', 20)
        .attr('text-anchor', 'middle')
        .attr('fill', '#4C4646')
        .attr('font-size', `${14 * phoneScale}px`)
        .attr('font-family', 'Lexend-Medium')
        .attr('pointer-events', 'none')
        .text(season);
      
      // Add vertical separator line (except for the last column)
      if (i < SCHEDULE_ORDER.length - 1) {
        backgroundColumns.append('line')
          .attr('x1', nextX)
          .attr('y1', 0)
          .attr('x2', nextX)
          .attr('y2', height)
          .attr('stroke', '#4C4646')
          .attr('stroke-width', 1 * phoneScale)
          .attr('stroke-opacity', 0.3)
          .attr('pointer-events', 'none');
      }
    });
  }
  
  // Update node radii if viewport size changed (e.g., phone rotation)
  if (nodeGroups) {
    const phoneScale = getPhoneViewScale();
    nodeGroups.each(function(d) {
      const radius = getNodeRadius(d.scale);
      const group = d3.select(this);
      group.select('circle').attr('r', radius);
      group.select('image')
        .attr('x', -radius)
        .attr('y', -radius)
        .attr('width', radius * 2)
        .attr('height', radius * 2);
      group.select('text.node-label')
        .attr('dy', radius + 14 * phoneScale)
        .attr('font-size', 10 * phoneScale);
      // Update clipPath if it exists
      if (d.clipId) {
        const clipPath = svg.select(`#${d.clipId} circle`);
        if (!clipPath.empty()) {
          clipPath.attr('r', radius);
        }
      }
    });
  }
  
  simulation.alpha(0.3).restart();
}

/**
 * Initialize the application
 */
async function init() {
  // Load data
  const data = await loadData();
  
  if (data.nodes.length === 0) {
    console.error('No data loaded');
    return;
  }
  
  // Initialize visualization
  initVisualization(data);
  
  // Build filters
  buildFilters();
  
  // Set up event listeners
  document.getElementById('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    applyFilters();
  });
  
  document.getElementById('reset-filters').addEventListener('click', resetFilters);
  
  // Filters popup toggle
  const filtersBtn = document.getElementById('filters-btn');
  const filtersPopup = document.getElementById('filters-popup');
  const filtersBackdrop = document.getElementById('filters-backdrop');
  const closeFiltersBtn = document.getElementById('close-filters');
  
  function openFiltersPopup() {
    filtersPopup.classList.add('active');
    filtersBackdrop.classList.add('active');
  }
  
  function closeFiltersPopup() {
    filtersPopup.classList.remove('active');
    filtersBackdrop.classList.remove('active');
  }
  
  filtersBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openFiltersPopup();
  });
  
  closeFiltersBtn.addEventListener('click', () => {
    closeFiltersPopup();
  });
  
  // Close filters popup when clicking on backdrop
  filtersBackdrop.addEventListener('click', () => {
    closeFiltersPopup();
  });
  
  // Close filters popup when clicking outside
  document.addEventListener('click', (e) => {
    if (filtersPopup.classList.contains('active') && 
        !filtersPopup.contains(e.target) && 
        e.target !== filtersBtn &&
        !filtersBackdrop.contains(e.target)) {
      closeFiltersPopup();
    }
  });
  
  // Fullscreen toggle
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error('Error attempting to enable fullscreen:', err);
      });
      fullscreenBtn.textContent = 'exit full screen';
    } else {
      document.exitFullscreen();
      fullscreenBtn.textContent = 'full screen';
    }
  });
  
  // Update fullscreen button text when exiting fullscreen via ESC
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      fullscreenBtn.textContent = 'full screen';
    }
  });
  
  // Handle window resize
  window.addEventListener('resize', handleResize);
  
  // Update popup position on zoom/pan
  if (svg) {
    svg.on('zoom', () => {
      if (clickedNode) {
        updatePopupPosition(clickedNode);
      }
    });
  }
}

// Start the application
init();

