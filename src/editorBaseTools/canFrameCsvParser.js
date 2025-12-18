/**
 * CAN Frame CSV Parser
 * Parses CSV files containing raw CAN frame data in the mdf2csv format.
 * 
 * Expected CSV format (semicolon-separated):
 * TimestampEpoch;BusChannel;ID;IDE;DLC;DataLength;Dir;EDL;BRS;ESI;RTR;DataBytes
 */

// Required columns for valid CSV
const REQUIRED_COLUMNS = [
  'TimestampEpoch', 'BusChannel', 'ID', 'IDE', 'DLC', 
  'DataLength', 'Dir', 'EDL', 'BRS', 'ESI', 'RTR', 'DataBytes'
];

/**
 * Validate CSV header structure
 * @param {string} headerLine - The first line of the CSV
 * @returns {Object} { valid: boolean, missingColumns: string[] }
 */
export function validateCsvHeader(headerLine) {
  const columns = headerLine.split(';').map(col => col.trim());
  const missingColumns = REQUIRED_COLUMNS.filter(req => !columns.includes(req));
  return {
    valid: missingColumns.length === 0,
    missingColumns
  };
}

/**
 * Parse a CSV string containing CAN frame data into an array of frame objects
 * @param {string} csvContent - The raw CSV content
 * @returns {Object} { frames: Array, error: string|null }
 */
export function parseCanFrameCsv(csvContent) {
  const lines = csvContent.trim().split('\n');
  
  if (lines.length < 2) {
    return { frames: [], error: null };
  }
  
  // Validate header
  const headerValidation = validateCsvHeader(lines[0]);
  if (!headerValidation.valid) {
    return { 
      frames: [], 
      error: `Invalid CSV format. Missing columns: ${headerValidation.missingColumns.join(', ')}`
    };
  }
  
  // Parse header to get column indices
  const header = lines[0].split(';');
  const columnIndex = {};
  header.forEach((col, idx) => {
    columnIndex[col.trim()] = idx;
  });
  
  const frames = [];
  const expectedColumnCount = header.length;
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const values = line.split(';');
    
    // Reject lines that don't have the expected number of columns
    if (values.length < expectedColumnCount) {
      continue;
    }
    
    // Validate required fields have valid values
    const timestamp = parseFloat(values[columnIndex['TimestampEpoch']]);
    const busChannel = parseInt(values[columnIndex['BusChannel']]);
    const id = values[columnIndex['ID']];
    
    // Reject lines with invalid timestamp, busChannel, or empty ID
    if (isNaN(timestamp) || isNaN(busChannel) || !id || !/^[0-9A-Fa-f]+$/.test(id)) {
      continue;
    }
    
    const frame = {
      timestamp: timestamp,
      busChannel: busChannel,
      id: id,
      ide: parseInt(values[columnIndex['IDE']] || 0), // 0 = 11-bit, 1 = 29-bit
      dlc: parseInt(values[columnIndex['DLC']] || 0),
      dataLength: parseInt(values[columnIndex['DataLength']] || 0),
      dir: parseInt(values[columnIndex['Dir']] || 0), // 0 = receive, 1 = transmit
      edl: parseInt(values[columnIndex['EDL']] || 0),
      brs: parseInt(values[columnIndex['BRS']] || 0),
      esi: parseInt(values[columnIndex['ESI']] || 0),
      rtr: parseInt(values[columnIndex['RTR']] || 0),
      dataBytes: values[columnIndex['DataBytes']] || ''
    };
    
    frames.push(frame);
  }
  
  return { frames, error: null };
}

/**
 * Filter frames to get only receive frames (Dir = 0)
 * @param {Array} frames - Array of CAN frame objects
 * @returns {Array} Filtered array of receive frames
 */
export function getReceiveFrames(frames) {
  return frames.filter(frame => frame.dir === 0);
}

/**
 * Extract PGN from a 29-bit CAN ID
 * For PDU1 format PGNs, applies mask 0x3FF0000 and shifts right by 8
 * @param {string} canId - The CAN ID as a hex string
 * @returns {number} The PGN value
 */
export function extractPgn(canId) {
  const idValue = parseInt(canId, 16);
  // Apply mask 0x3FF0000 to get PGN bits, then shift right by 8
  return (idValue & 0x3FF0000) >> 8;
}

/**
 * Check if a 29-bit CAN ID corresponds to OBD response PGN (0xDA00)
 * @param {string} canId - The CAN ID as a hex string
 * @returns {boolean} True if the CAN ID is an OBD response
 */
export function isObdResponse29Bit(canId) {
  const pgn = extractPgn(canId);
  return pgn === 0xDA00;
}

export default {
  parseCanFrameCsv,
  getReceiveFrames,
  extractPgn,
  isObdResponse29Bit
};
