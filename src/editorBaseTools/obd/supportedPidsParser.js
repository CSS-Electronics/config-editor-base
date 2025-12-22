/**
 * Supported PIDs Parser
 * Parses OBD response data to determine which PIDs are supported by a vehicle.
 */

import { parseCanFrameCsv, getReceiveFrames, isObdResponse29Bit } from '../canFrameCsvParser';

/**
 * Parse supported PIDs from CSV content
 * @param {string} csvContent - The raw CSV content from mdf2csv
 * @returns {Object} Object containing supported PIDs info and detected settings
 */
export function parseSupportedPids(csvContent) {
  const parseResult = parseCanFrameCsv(csvContent);
  
  if (parseResult.error) {
    throw new Error(parseResult.error);
  }
  
  const receiveFrames = getReceiveFrames(parseResult.frames);
  
  // Separate 11-bit and 29-bit OBD responses
  const obd11BitResponses = receiveFrames.filter(f => f.ide === 0 && f.id === '7E8');
  const obd29BitResponses = receiveFrames.filter(f => f.ide === 1 && isObdResponse29Bit(f.id));
  
  // Check for mixed CAN ID types
  const hasBothIdTypes = obd11BitResponses.length > 0 && obd29BitResponses.length > 0;
  
  // Determine which response type we have (typically one or the other, not both)
  const use29Bit = obd29BitResponses.length > obd11BitResponses.length;
  const relevantResponses = use29Bit ? obd29BitResponses : obd11BitResponses;
  
  // Detect protocol (OBD2 vs WWH-OBD) and extract supported PIDs
  // Only process "supported PIDs" query responses where PID is 0x00, 0x20, 0x40, 0x60, 0x80, 0xA0, or 0xC0
  const SUPPORTED_PIDS_QUERY_VALUES = [0x00, 0x20, 0x40, 0x60, 0x80, 0xA0, 0xC0];
  const protocolsDetected = new Set();
  const supportedPidsSet = new Set();
  
  for (const frame of relevantResponses) {
    const data = frame.dataBytes.toUpperCase();
    
    if (data.length < 16) continue; // Need at least 8 bytes (16 hex chars)
    
    // Check for OBD2 protocol: first two bytes are 0641
    if (data.startsWith('0641')) {
      const pidRangeStart = parseInt(data.substring(4, 6), 16); // 3rd byte is the PID (00, 20, 40, etc.)
      
      // Only process if this is a "supported PIDs" query response
      if (!SUPPORTED_PIDS_QUERY_VALUES.includes(pidRangeStart)) continue;
      
      protocolsDetected.add('OBD2');
      const supportBits = data.substring(6, 14); // Bytes 4-7 contain the support bitmap
      
      extractSupportedPidsFromBitmap(pidRangeStart, supportBits, supportedPidsSet);
    }
    // Check for WWH-OBD protocol: bytes 2-3 are 62F4
    else if (data.substring(2, 6) === '62F4') {
      const pidRangeStart = parseInt(data.substring(6, 8), 16); // 4th byte is the PID
      
      // Only process if this is a "supported PIDs" query response
      if (!SUPPORTED_PIDS_QUERY_VALUES.includes(pidRangeStart)) continue;
      
      protocolsDetected.add('WWH-OBD');
      const supportBits = data.substring(8, 16); // Last 4 bytes contain the support bitmap
      
      extractSupportedPidsFromBitmap(pidRangeStart, supportBits, supportedPidsSet);
    }
  }
  
  // Check for mixed protocols
  const hasMixedProtocols = protocolsDetected.size > 1;
  const protocol = protocolsDetected.size > 0 ? Array.from(protocolsDetected)[0] : null;
  
  // Convert set to sorted array of PID hex strings
  const supportedPids = Array.from(supportedPidsSet)
    .sort((a, b) => a - b)
    .map(pid => pid.toString(16).toUpperCase().padStart(2, '0'));
  
  return {
    supportedPids,
    protocol,
    transmitId: use29Bit ? '18DB33F1' : '7DF',
    canIdType: use29Bit ? '29bit' : '11bit',
    responseCount: relevantResponses.length,
    totalFrames: parseResult.frames.length,
    hasMixedIds: hasBothIdTypes,
    hasMixedProtocols: hasMixedProtocols,
    allProtocolsDetected: Array.from(protocolsDetected),
    obd11BitCount: obd11BitResponses.length,
    obd29BitCount: obd29BitResponses.length
  };
}

/**
 * Extract supported PIDs from a 4-byte bitmap
 * @param {number} rangeStart - The starting PID for this range (0x00, 0x20, 0x40, etc.)
 * @param {string} bitmapHex - 4 bytes (8 hex chars) representing the support bitmap
 * @param {Set} supportedSet - Set to add supported PID numbers to
 */
function extractSupportedPidsFromBitmap(rangeStart, bitmapHex, supportedSet) {
  // Skip the "supported PIDs" query PIDs themselves (0x00, 0x20, 0x40, etc.)
  // These are just query PIDs, not actual data PIDs
  
  // Convert hex string to binary
  const bitmapValue = parseInt(bitmapHex, 16);
  
  // Each bit represents a PID, starting from rangeStart + 1
  // Bit 31 (MSB) = PID rangeStart + 1
  // Bit 30 = PID rangeStart + 2
  // ...
  // Bit 0 (LSB) = PID rangeStart + 32
  for (let i = 0; i < 32; i++) {
    const bitPosition = 31 - i;
    const isSupported = (bitmapValue >> bitPosition) & 1;
    
    if (isSupported) {
      const pid = rangeStart + i + 1;
      
      // Skip the "supported PIDs" query PIDs (0x00, 0x20, 0x40, 0x60, 0x80, 0xA0, 0xC0)
      // These just indicate whether there are more PIDs to query, not actual data
      if (pid !== 0x20 && pid !== 0x40 && pid !== 0x60 && 
          pid !== 0x80 && pid !== 0xA0 && pid !== 0xC0 && pid !== 0xE0) {
        supportedSet.add(pid);
      }
    }
  }
}

export default {
  parseSupportedPids
};
