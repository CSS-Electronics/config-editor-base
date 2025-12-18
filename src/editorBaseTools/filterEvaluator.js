/**
 * Filter Evaluator Module
 * Applies CAN filter settings from Configuration File to CSV frame data
 * 
 * Filter structure:
 * - state: 0 = disabled, 1 = enabled
 * - type: 0 = acceptance, 1 = rejection
 * - id_format: 0 = standard (11-bit), 1 = extended (29-bit)
 * - method: 0 = range, 1 = mask
 * - f1: start of range / filter ID (hex)
 * - f2: end of range / filter mask (hex)
 * - prescaler_type: 0 = none, 1 = count, 2 = time, 3 = data
 * - prescaler_value: depends on prescaler_type
 * 
 * Channel mapping:
 * - BusChannel 1 → can_1
 * - BusChannel 2 → can_2
 * - BusChannel 9 → can_internal
 */

/**
 * Extract filter configuration from the Configuration File for all CAN channels
 * @param {Object} configData - The parsed Configuration File JSON
 * @returns {Object} Map of channel number to filter config
 */
export function extractFilters(configData) {
  const filters = {};
  
  // Map BusChannel numbers to config keys
  const channelMap = {
    1: 'can_1',
    2: 'can_2',
    9: 'can_internal'
  };
  
  for (const [busChannel, configKey] of Object.entries(channelMap)) {
    const channelConfig = configData[configKey];
    if (channelConfig && channelConfig.filter && channelConfig.filter.id) {
      filters[busChannel] = {
        remoteFrames: channelConfig.filter.remote_frames || 0,
        idFilters: channelConfig.filter.id.filter(f => f.state === 1) // Only enabled filters
      };
    }
  }
  
  return filters;
}

/**
 * Check if a message ID matches a filter using range method
 * @param {number} messageId - The message ID (integer)
 * @param {number} f1 - Start of range (integer)
 * @param {number} f2 - End of range (integer)
 * @returns {boolean} True if message matches
 */
function matchesRange(messageId, f1, f2) {
  return messageId >= f1 && messageId <= f2;
}

/**
 * Check if a message ID matches a filter using mask method
 * filter_id & filter_mask == message_id & filter_mask
 * @param {number} messageId - The message ID (integer)
 * @param {number} filterId - The filter ID (f1, integer)
 * @param {number} filterMask - The filter mask (f2, integer)
 * @returns {boolean} True if message matches
 */
function matchesMask(messageId, filterId, filterMask) {
  return (filterId & filterMask) === (messageId & filterMask);
}

/**
 * Check if a frame matches a single filter
 * @param {Object} frame - The CAN frame object
 * @param {Object} filter - The filter configuration
 * @returns {boolean} True if frame matches the filter
 */
function frameMatchesFilter(frame, filter) {
  // Check ID format match (0 = standard/11-bit, 1 = extended/29-bit)
  const isExtended = frame.ide === 1;
  const filterIsExtended = filter.id_format === 1;
  
  if (isExtended !== filterIsExtended) {
    return false;
  }
  
  const messageId = parseInt(frame.id, 16);
  const f1 = parseInt(filter.f1, 16);
  const f2 = parseInt(filter.f2, 16);
  
  if (filter.method === 0) {
    // Range method
    return matchesRange(messageId, f1, f2);
  } else {
    // Mask method
    return matchesMask(messageId, f1, f2);
  }
}

// Maximum number of unique CAN IDs per channel that can have prescalers applied
// This is a hardware limitation - the device can only track prescaler state for 100 unique IDs per channel
const MAX_PRESCALER_IDS_PER_CHANNEL = 100;

/**
 * Apply prescaler logic to determine if a frame should be accepted
 * Hardware limitation: Only the first 100 unique CAN IDs per channel can have prescalers applied.
 * Any subsequent unique IDs beyond this limit will be accepted without prescaling.
 * @param {Object} frame - The CAN frame object
 * @param {Object} filter - The matching filter with prescaler settings
 * @param {Object} prescalerState - State tracking for prescalers (modified in place)
 * @returns {boolean} True if frame passes prescaler
 */
function applyPrescaler(frame, filter, prescalerState) {
  const prescalerType = filter.prescaler_type || 0;
  
  // No prescaling
  if (prescalerType === 0) {
    return true;
  }
  
  // For data prescaler (type 3), empty/undefined value means "all bytes" (no default to 1)
  // For count/time prescalers, default to 1 if not specified
  const prescalerValue = prescalerType === 3 
    ? (filter.prescaler_value !== undefined ? filter.prescaler_value : "")
    : (filter.prescaler_value || 1);
  const channelKey = `channel_${frame.busChannel}`;
  const idKey = `${frame.busChannel}_${frame.id}`;
  
  // Initialize channel tracking if not exists
  if (!prescalerState._channelIdCounts) {
    prescalerState._channelIdCounts = {};
  }
  if (!prescalerState._channelIdCounts[channelKey]) {
    prescalerState._channelIdCounts[channelKey] = new Set();
  }
  
  const channelIdSet = prescalerState._channelIdCounts[channelKey];
  const isNewId = !channelIdSet.has(frame.id);
  
  // Check if this is a new ID and we've exceeded the limit
  if (isNewId) {
    if (channelIdSet.size >= MAX_PRESCALER_IDS_PER_CHANNEL) {
      // Exceeded 100 unique IDs for this channel - accept without prescaling
      return true;
    }
    // Register this new ID
    channelIdSet.add(frame.id);
  }
  
  // Initialize state for this channel+ID if not exists
  if (!prescalerState[idKey]) {
    prescalerState[idKey] = {
      count: 0,
      lastAcceptedTime: null,
      lastData: null
    };
  }
  
  const state = prescalerState[idKey];
  
  if (prescalerType === 1) {
    // Count prescaler: accept every Nth message
    // Accept at message 1, then every Nth after (messages 1, N+1, 2N+1, ...)
    // Example with prescaler=3: accept messages 1, 4, 7, 10... (33% acceptance)
    const accept = (state.count % prescalerValue) === 0;
    state.count++;
    return accept;
    
  } else if (prescalerType === 2) {
    // Time prescaler: accept if elapsed time >= prescaler_value ms
    const timestamp = frame.timestamp * 1000; // Convert to ms
    
    if (state.lastAcceptedTime === null) {
      state.lastAcceptedTime = timestamp;
      return true;
    }
    
    const elapsed = timestamp - state.lastAcceptedTime;
    if (elapsed >= prescalerValue) {
      state.lastAcceptedTime = timestamp;
      return true;
    }
    return false;
    
  } else if (prescalerType === 3) {
    // Data prescaler: accept if masked data bytes changed
    const currentData = frame.dataBytes;
    
    if (state.lastData === null) {
      state.lastData = currentData;
      return true;
    }
    
    // Parse the mask - each bit represents a byte position
    const maskValue = prescalerValue ? parseInt(prescalerValue, 16) : 0xFFFFFFFFFFFFFFFFn;
    
    // Compare data bytes based on mask
    const prevBytes = parseDataBytes(state.lastData);
    const currBytes = parseDataBytes(currentData);
    
    let changed = false;
    for (let i = 0; i < Math.max(prevBytes.length, currBytes.length); i++) {
      // Check if this byte position is masked (bit is set)
      const byteMask = BigInt(1) << BigInt(i);
      if ((BigInt(maskValue) & byteMask) !== BigInt(0)) {
        const prevByte = prevBytes[i] || 0;
        const currByte = currBytes[i] || 0;
        if (prevByte !== currByte) {
          changed = true;
          break;
        }
      }
    }
    
    if (changed) {
      state.lastData = currentData;
      return true;
    }
    return false;
  }
  
  return true;
}

/**
 * Parse data bytes string into array of byte values
 * @param {string} dataBytes - Hex string of data bytes (e.g., "00 11 22 33" or "00112233")
 * @returns {number[]} Array of byte values
 */
function parseDataBytes(dataBytes) {
  if (!dataBytes) return [];
  
  // Remove spaces and parse as hex pairs
  const cleaned = dataBytes.replace(/\s+/g, '');
  const bytes = [];
  for (let i = 0; i < cleaned.length; i += 2) {
    bytes.push(parseInt(cleaned.substr(i, 2), 16));
  }
  return bytes;
}

/**
 * Process a single frame through the filter list for its channel
 * @param {Object} frame - The CAN frame object
 * @param {Array} filters - Array of filter configurations for this channel
 * @param {Object} prescalerState - State tracking for prescalers
 * @returns {boolean} True if frame is accepted
 */
function processFrame(frame, filters, prescalerState) {
  // No filters means reject all (as per documentation)
  if (!filters || filters.length === 0) {
    return false;
  }
  
  // Process filters sequentially
  for (const filter of filters) {
    if (frameMatchesFilter(frame, filter)) {
      // Filter matched
      if (filter.type === 1) {
        // Rejection filter
        return false;
      } else {
        // Acceptance filter - check prescaler
        return applyPrescaler(frame, filter, prescalerState);
      }
    }
  }
  
  // No filter matched - reject by default
  return false;
}

/**
 * Apply filters to an array of CAN frames
 * @param {Array} frames - Array of parsed CAN frame objects
 * @param {Object} filterConfig - Filter configuration extracted from config file
 * @returns {Object} { filteredFrames: Array, stats: Object }
 */
export function applyFilters(frames, filterConfig) {
  const filteredFrames = [];
  const prescalerState = {};
  
  // Stats per channel
  const stats = {
    totalFrames: frames.length,
    acceptedFrames: 0,
    rejectedFrames: 0,
    byChannel: {}
  };
  
  for (const frame of frames) {
    const channelFilters = filterConfig[frame.busChannel];
    const channelKey = `CAN${frame.busChannel}`;
    
    // Initialize channel stats
    if (!stats.byChannel[channelKey]) {
      stats.byChannel[channelKey] = { total: 0, accepted: 0, rejected: 0 };
    }
    stats.byChannel[channelKey].total++;
    
    let accepted = false;
    
    if (channelFilters) {
      // Check remote frames filter first
      if (frame.rtr === 1 && channelFilters.remoteFrames === 0) {
        accepted = false;
      } else {
        accepted = processFrame(frame, channelFilters.idFilters, prescalerState);
      }
    } else {
      // No filter config for this channel - accept by default (assume default filters)
      accepted = true;
    }
    
    if (accepted) {
      filteredFrames.push(frame);
      stats.acceptedFrames++;
      stats.byChannel[channelKey].accepted++;
    } else {
      stats.rejectedFrames++;
      stats.byChannel[channelKey].rejected++;
    }
  }
  
  return { filteredFrames, stats };
}

/**
 * Calculate size reduction percentage
 * @param {number} originalCount - Original frame count
 * @param {number} filteredCount - Filtered frame count
 * @returns {number} Reduction percentage (0-100)
 */
export function calculateReduction(originalCount, filteredCount) {
  if (originalCount === 0) return 0;
  return ((originalCount - filteredCount) / originalCount) * 100;
}

/**
 * Main function to evaluate CSV data with filter settings
 * @param {Array} frames - Array of parsed CAN frame objects from CSV
 * @param {Object} configData - The parsed Configuration File JSON
 * @returns {Object} { filteredFrames, stats, reductionPercent }
 */
export function evaluateFilters(frames, configData) {
  const filterConfig = extractFilters(configData);
  const { filteredFrames, stats } = applyFilters(frames, filterConfig);
  const reductionPercent = calculateReduction(frames.length, filteredFrames.length);
  
  return {
    filteredFrames,
    stats,
    reductionPercent
  };
}
