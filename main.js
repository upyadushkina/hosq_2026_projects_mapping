// Global state
let nodes = [];
let links = [];
let simulation = null;
let svg = null;
let g = null;
let nodeElements = null;
let nodeGroups = null;
let linkElements = null;
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
        .attr('r', 5 + node.scale * 5);
    }
  });
  
  // Create circles for nodes (background/fill)
  nodeElements = nodeGroups.append('circle')
    .attr('class', 'node')
    .attr('r', d => 5 + d.scale * 5)
    .attr('fill', d => d.color)
    .attr('stroke', '#262123')
    .attr('stroke-width', 2);

  // Add images inside circles for nodes with photos
  nodeGroups.filter(d => d.clipId).append('image')
    .attr('href', d => d.photoLink)
    .attr('xlink:href', d => d.photoLink)
    .attr('x', d => -(5 + d.scale * 5))
    .attr('y', d => -(5 + d.scale * 5))
    .attr('width', d => (5 + d.scale * 5) * 2)
    .attr('height', d => (5 + d.scale * 5) * 2)
    .attr('preserveAspectRatio', 'xMidYMid slice')
    .attr('clip-path', d => `url(#${d.clipId})`);
  
  // Add labels (project names) to all nodes
  const nodeLabels = nodeGroups.append('text')
    .attr('class', 'node-label')
    .text(d => d.name)
    .attr('font-size', 10)
    .attr('text-anchor', 'middle')
    .attr('dy', d => (5 + d.scale * 5) + 14) // Position below the circle
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
    // Only close if clicking on background (not on a node or popup)
    if (event.target === svg.node() || event.target === g.node()) {
      clickedNode = null;
      hoveredNode = null;
      hidePopup();
    }
  });
  
  // Handle clicks outside popup to close it (for mobile and desktop)
  document.addEventListener('click', function(event) {
    const popup = document.getElementById('popup');
    if (!popup || popup.style.display !== 'block') return;
    
    // Don't close if clicking inside the popup
    if (popup.contains(event.target)) {
      return;
    }
    
    // Don't close if clicking on a node
    if (event.target.closest('.node-group') || 
        event.target.classList.contains('node') ||
        event.target.closest('circle')) {
      return;
    }
    
    // Close popup if clicking outside
    clickedNode = null;
    hoveredNode = null;
    hidePopup();
  });
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
  
  // Highlight edges connected to this node
  linkElements
    .classed('highlighted', l => l.source.id === d.id || l.target.id === d.id)
    .attr('stroke-opacity', l => 
      (l.source.id === d.id || l.target.id === d.id) ? 1 : 0.2
    );
  
  // Reduce opacity of nodes with different type (both circles and labels)
  nodeGroups.select('circle').attr('opacity', n => {
    if (n.id === d.id) return 1;
    if (n.type === d.type) return 1;
    return 0.15; // Stronger opacity reduction for non-matching types
  });
  
  nodeGroups.select('text').attr('opacity', n => {
    if (n.id === d.id) return 1;
    if (n.type === d.type) return 1;
    return 0.15; // Apply same opacity reduction to labels
  });
  
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
  
  // Type (in smaller text, color #4C4646)
  html += `<div class="popup-type">${node.type}</div>`;
  
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
  
  popup.querySelectorAll('.popup-tag').forEach(tagEl => {
    tagEl.addEventListener('click', (event) => {
      event.stopPropagation();
      const fieldValue = tagEl.getAttribute('data-field');
      if (!fieldValue) return;
      toggleFieldFilter(fieldValue);
      const isActiveNow = selectedFields.has(fieldValue);
      tagEl.classList.toggle('active', isActiveNow);
    });
  });
  
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
  if (!nodeGroups) return;
  
  // Apply opacity to both circles and labels
  nodeGroups.select('circle').attr('opacity', d => {
    // Check type filter
    if (selectedTypes.size > 0 && !selectedTypes.has(d.type)) {
      return 0.15;
    }
    
    // Check fields filter
    if (selectedFields.size > 0) {
      const hasMatchingField = d.fields.some(field => selectedFields.has(field));
      if (!hasMatchingField) {
        return 0.15;
      }
    }
    
    // Check search query
    if (searchQuery && !d.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return 0.15;
    }
    
    return 1;
  });
  
  nodeGroups.select('text').attr('opacity', d => {
    // Check type filter
    if (selectedTypes.size > 0 && !selectedTypes.has(d.type)) {
      return 0.15;
    }
    
    // Check fields filter
    if (selectedFields.size > 0) {
      const hasMatchingField = d.fields.some(field => selectedFields.has(field));
      if (!hasMatchingField) {
        return 0.15;
      }
    }
    
    // Check search query
    if (searchQuery && !d.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return 0.15;
    }
    
    return 1;
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

