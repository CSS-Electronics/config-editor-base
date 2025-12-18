/**
 * DBC File Parser
 * Parses DBC files to extract message IDs, names, comments, and signals.
 * Supports J1939 protocol detection and CAN channel prefix validation.
 */

/**
 * Extract CAN channel from filename prefix (e.g., "can1-", "can2-", etc.)
 * @param {string} filename - The DBC filename
 * @returns {string|null} - CAN channel number (1-11) or null if no valid prefix
 */
export function extractCanChannel(filename) {
  const match = filename.toLowerCase().match(/^can(\d{1,2})-/);
  if (match) {
    const channelNum = parseInt(match[1], 10);
    if (channelNum >= 1 && channelNum <= 11) {
      return channelNum.toString();
    }
  }
  return null;
}

/**
 * Check if DBC file is J1939 protocol
 * @param {string} dbcContent - The raw DBC file content
 * @returns {boolean} - True if J1939 protocol
 */
export function isJ1939Protocol(dbcContent) {
  // Look for BA_ "ProtocolType" "J1939";
  const protocolMatch = dbcContent.match(/BA_\s+"ProtocolType"\s+"([^"]+)"/);
  return protocolMatch && protocolMatch[1] === 'J1939';
}

/**
 * Parse a single DBC file
 * @param {string} dbcContent - The raw DBC file content
 * @param {string} filename - The DBC filename (for channel extraction)
 * @returns {Object} - Parsed DBC data
 */
export function parseDbcFile(dbcContent, filename) {
  const channel = extractCanChannel(filename);
  const isJ1939 = isJ1939Protocol(dbcContent);
  
  const messages = new Map();
  
  // Parse messages: BO_ <ID> <Name>: <Length> <Sender>
  const messageRegex = /BO_\s+(\d+)\s+(\w+)\s*:\s*(\d+)\s+(\w+)/g;
  let match;
  
  while ((match = messageRegex.exec(dbcContent)) !== null) {
    const rawId = parseInt(match[1], 10);
    const name = match[2];
    const length = parseInt(match[3], 10);
    
    // Apply 29-bit mask (0x1FFFFFFF) for extended CAN IDs
    // DBC files store 32-bit IDs, but CAN uses 29-bit for extended frames
    const id = rawId > 0x7FF ? (rawId & 0x1FFFFFFF) : rawId;
    
    messages.set(rawId, {
      id,
      rawId,
      idHex: id.toString(16).toUpperCase(),
      name,
      length,
      comment: '',
      signals: []
    });
  }
  
  // Parse signals: SG_ <SignalName> : <StartBit>|<Length>@...
  // We only need signal names, not the decoding rules
  // Signals appear after their message definition, indented with space
  const lines = dbcContent.split('\n');
  let currentMessageRawId = null;
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Check for message definition (BO_ starts at beginning of line or with minimal indent)
    const msgMatch = trimmedLine.match(/^BO_\s+(\d+)\s+(\w+)\s*:/);
    if (msgMatch) {
      currentMessageRawId = parseInt(msgMatch[1], 10);
      continue;
    }
    
    // Check for signal definition (SG_ typically indented under message)
    const sigMatch = trimmedLine.match(/^SG_\s+(\w+)\s+:/);
    if (sigMatch && currentMessageRawId !== null && messages.has(currentMessageRawId)) {
      messages.get(currentMessageRawId).signals.push(sigMatch[1]);
      continue;
    }
    
    // Reset current message if we hit a new major section (but not for empty lines within message block)
    if (trimmedLine.startsWith('CM_') || trimmedLine.startsWith('BA_') || 
        trimmedLine.startsWith('VAL_') || trimmedLine.startsWith('BO_TX_BU_')) {
      currentMessageRawId = null;
    }
  }
  
  // Parse message comments: CM_ BO_ <ID> "<Comment>";
  const commentRegex = /CM_\s+BO_\s+(\d+)\s+"([^"]*(?:\\.[^"]*)*)"\s*;/g;
  while ((match = commentRegex.exec(dbcContent)) !== null) {
    const id = parseInt(match[1], 10);
    const comment = match[2].replace(/\\"/g, '"').replace(/\\n/g, '\n');
    
    if (messages.has(id)) {
      messages.get(id).comment = comment;
    }
  }
  
  return {
    filename,
    channel,
    isJ1939,
    messages: Array.from(messages.values()),
    hasValidPrefix: channel !== null
  };
}

/**
 * Parse multiple DBC files
 * @param {Array} files - Array of {name, content} objects
 * @returns {Object} - Combined parsed data with warnings
 */
export function parseDbcFiles(files) {
  const results = [];
  const filesWithoutPrefix = [];
  const channelJ1939Map = new Map(); // Track which channels are J1939
  
  for (const file of files) {
    const parsed = parseDbcFile(file.content, file.name);
    results.push(parsed);
    
    if (!parsed.hasValidPrefix) {
      filesWithoutPrefix.push(file.name);
    }
    
    // Track J1939 channels
    if (parsed.channel && parsed.isJ1939) {
      channelJ1939Map.set(parsed.channel, true);
    }
  }
  
  // Build combined message map by channel + ID
  const allMessages = new Map();
  
  for (const result of results) {
    if (!result.hasValidPrefix) continue;
    
    for (const msg of result.messages) {
      const key = `CAN${result.channel}_${msg.idHex}`;
      allMessages.set(key, {
        channel: `CAN${result.channel}`,
        channelNum: result.channel,
        id: msg.id,
        rawId: msg.rawId,
        idHex: msg.idHex,
        name: msg.name,
        comment: msg.comment,
        signals: msg.signals,
        isJ1939: result.isJ1939
      });
    }
  }
  
  return {
    parsedFiles: results,
    allMessages,
    filesWithoutPrefix,
    channelJ1939Map,
    hasWarnings: filesWithoutPrefix.length > 0
  };
}

/**
 * J1939 PGN utilities
 */

/**
 * Get PDU Format (PF) from a 29-bit CAN ID
 * @param {number} canId - The 29-bit CAN ID
 * @returns {number} - PDU Format value (0-255)
 */
export function getPduFormat(canId) {
  return (canId >> 16) & 0xFF;
}

/**
 * Determine if a CAN ID is PDU1 or PDU2
 * PDU1: PF < 240, PDU2: PF >= 240
 * @param {number} canId - The 29-bit CAN ID
 * @returns {string} - 'PDU1' or 'PDU2'
 */
export function getPduType(canId) {
  const pf = getPduFormat(canId);
  return pf < 240 ? 'PDU1' : 'PDU2';
}

/**
 * Extract PGN from a 29-bit CAN ID
 * PDU1: mask 0x3FF0000, shift right 8 (clears destination address)
 * PDU2: mask 0x3FFFF00, shift right 8
 * @param {number} canId - The 29-bit CAN ID
 * @returns {number} - The PGN value
 */
export function extractPgn(canId) {
  const pf = getPduFormat(canId);
  if (pf < 240) {
    // PDU1: Clear destination address (PS field)
    return (canId >> 8) & 0x3FF00;
  } else {
    // PDU2: Include PS field as part of PGN
    return (canId >> 8) & 0x3FFFF;
  }
}

/**
 * Get the PGN mask for matching CAN IDs
 * @param {number} canId - The 29-bit CAN ID
 * @returns {number} - The mask to apply for PGN comparison
 */
export function getPgnMask(canId) {
  const pf = getPduFormat(canId);
  if (pf < 240) {
    // PDU1: mask out source address and destination address
    return 0x3FF0000;
  } else {
    // PDU2: mask out only source address
    return 0x3FFFF00;
  }
}

/**
 * Check if two CAN IDs match based on J1939 PGN
 * @param {number} canId1 - First CAN ID
 * @param {number} canId2 - Second CAN ID (typically from DBC)
 * @returns {boolean} - True if PGNs match
 */
export function j1939PgnMatch(canId1, canId2) {
  const pgn1 = extractPgn(canId1);
  const pgn2 = extractPgn(canId2);
  return pgn1 === pgn2;
}

/**
 * Find matching DBC message for a CAN frame
 * @param {string} channel - CAN channel (e.g., "CAN1")
 * @param {string} idHex - CAN ID as hex string
 * @param {Map} dbcMessages - Map of DBC messages
 * @param {Map} channelJ1939Map - Map of channels that are J1939
 * @returns {Object|null} - Matching DBC message or null
 */
export function findDbcMatch(channel, idHex, dbcMessages, channelJ1939Map) {
  const channelNum = channel.replace('CAN', '');
  const canId = parseInt(idHex, 16);
  const is29Bit = canId > 0x7FF;
  
  // Normalize the ID to uppercase hex without leading zeros for matching
  const normalizedIdHex = canId.toString(16).toUpperCase();
  
  // Direct match first (using normalized ID to handle leading zeros like "004" vs "4")
  const directKey = `${channel}_${normalizedIdHex}`;
  if (dbcMessages.has(directKey)) {
    return dbcMessages.get(directKey);
  }
  
  // If channel is J1939 and ID is 29-bit, try PGN matching
  if (channelJ1939Map.get(channelNum) && is29Bit) {
    for (const [key, msg] of dbcMessages) {
      if (!key.startsWith(channel + '_')) continue;
      if (!msg.isJ1939) continue;
      
      // Use rawId (original 32-bit DBC ID) for PGN matching
      const dbcId = msg.rawId || msg.id;
      if (j1939PgnMatch(canId, dbcId)) {
        return msg;
      }
    }
  }
  
  return null;
}

export default {
  extractCanChannel,
  isJ1939Protocol,
  parseDbcFile,
  parseDbcFiles,
  getPduFormat,
  getPduType,
  extractPgn,
  getPgnMask,
  j1939PgnMatch,
  findDbcMatch
};
