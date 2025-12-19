import React from "react";
import { connect } from "react-redux";
import Files from "react-files";
import * as actionsEditor from "../editorBase/actions";
import validator from "@rjsf/validator-ajv6";
import Form from "@rjsf/core";
import { parseCanFrameCsv } from "./canFrameCsvParser";
import { parseDbcFiles, findDbcMatch, extractPgn } from "./dbcParser";
import { evaluateFilters } from "./filterEvaluator";
import SimpleDropdown from "./SimpleDropdown";

const merge = require("deepmerge");

let yourForm;

// Prescaler options
const prescalerOptions = [
  { value: "none", label: "None" },
  { value: "count", label: "Count" },
  { value: "time", label: "Time" },
  { value: "data", label: "Data" }
];

// Filter limits per channel - CANedge
const MAX_11BIT_FILTERS_CANEDGE = 128;
const MAX_29BIT_FILTERS_CANEDGE = 64;

// Filter limits per channel - CANmod.router (32 total per channel, regardless of bit type)
const MAX_FILTERS_CANMOD_ROUTER = 32;

// Valid CAN channels for CANedge
const CANEDGE_CHANNELS = ["CAN1", "CAN2", "CAN9"];

// Minimum firmware versions for merge support
const MIN_FIRMWARE_CANEDGE = "01.09";
const MIN_FIRMWARE_CANMOD_ROUTER = "01.02";

class FilterBuilderTool extends React.Component {
  constructor(props) {
    super(props);

    this.handleCsvUpload = this.handleCsvUpload.bind(this);
    this.handleDbcUpload = this.handleDbcUpload.bind(this);
    this.parseCsvFile = this.parseCsvFile.bind(this);
    this.handleSearchChange = this.handleSearchChange.bind(this);
    this.handleEntryToggle = this.handleEntryToggle.bind(this);
    this.selectTop = this.selectTop.bind(this);
    this.selectMatched = this.selectMatched.bind(this);
    this.handleMasterToggle = this.handleMasterToggle.bind(this);
    this.mergeData = this.mergeData.bind(this);
    this.generateFilterConfig = this.generateFilterConfig.bind(this);
    this.testMergedFile = this.testMergedFile.bind(this);
    this.onMerge = this.onMerge.bind(this);
    this.onDownload = this.onDownload.bind(this);
    this.onSubmit = this.onSubmit.bind(this);
    this.onValidationError = this.onValidationError.bind(this);

    this.state = {
      csvFileName: "",
      dbcFileNames: [],
      csvData: null,
      filteredCsvData: null,
      dbcData: null,
      mergedEntries: [],
      searchQuery: "",
      groupJ1939Pgns: false,
      showFilteredSummary: false,
      filterReductionPercent: 0,
      isLoading: false,
      // Filter builder state
      filterType: "acceptance", // "acceptance" or "rejection"
      prescalerType: "none",
      prescalerValue: 1,
      dataPrescalerMask: "",
      filterMergeMode: "replace", // "replace" or "append"
      generatedFilterConfig: {},
      mergedConfig: {},
      mergedConfigValid: "Unknown",
      showFilterPreview: false,
      // CANmod.router channel mapping (CSV channel numbers for S1-S4)
      channelMapS1: "11",
      channelMapS2: "12",
      channelMapS3: "13",
      channelMapS4: "14"
    };

    this.csvFileReader = new FileReader();
    this.csvFileReader.onload = (event) => {
      this.parseCsvFile(event.target.result);
    };
    this.csvFileReader.onerror = (event) => {
      this.props.showAlert("danger", "Failed to read CSV file: " + (event.target.error?.message || "Unknown error"));
      this.setState({ isLoading: false });
    };

    this.pendingDbcFiles = [];
    this.dbcFilesLoaded = 0;
    this.rawFrames = []; // Store raw frames for filter evaluation
  }

  /**
   * Check if the loaded config is a CANmod.router
   * Uses detectedDeviceType from Redux state (set by actions.js)
   */
  isCanmodRouter() {
    return this.props.detectedDeviceType === "CANmod.router";
  }

  /**
   * Get valid channels for current device type based on channel mapping
   */
  getValidChannels() {
    if (this.props.deviceType === "CANmod") {
      if (!this.isCanmodRouter()) {
        return [];
      }
      const { channelMapS1, channelMapS2, channelMapS3, channelMapS4 } = this.state;
      return [`CAN${channelMapS1}`, `CAN${channelMapS2}`, `CAN${channelMapS3}`, `CAN${channelMapS4}`];
    }
    return CANEDGE_CHANNELS;
  }

  /**
   * Get the channel mapping for CANmod.router based on user-defined channel numbers
   */
  getChannelMapping() {
    const { channelMapS1, channelMapS2, channelMapS3, channelMapS4 } = this.state;
    return {
      [`CAN${channelMapS1}`]: "can_s1",
      [`CAN${channelMapS2}`]: "can_s2",
      [`CAN${channelMapS3}`]: "can_s3",
      [`CAN${channelMapS4}`]: "can_s4"
    };
  }

  /**
   * Check if a channel is valid for the current device configuration
   */
  isChannelValid(channel) {
    const validChannels = this.getValidChannels();
    return validChannels.includes(channel);
  }

  /**
   * Get firmware version from config filename
   */
  getConfigVersion() {
    const { editorConfigFiles } = this.props;
    if (editorConfigFiles && editorConfigFiles.length > 0) {
      const configFileName = editorConfigFiles[0].name;
      // Extract version like "01.09" from "config-01.09.json"
      const match = configFileName.match(/(\d{2}\.\d{2})/);
      return match ? match[1] : null;
    }
    return null;
  }

  /**
   * Check if firmware version meets minimum requirement
   */
  isFirmwareVersionSupported() {
    const version = this.getConfigVersion();
    if (!version) return false;
    
    if (this.props.deviceType === "CANmod") {
      return version >= MIN_FIRMWARE_CANMOD_ROUTER;
    }
    return version >= MIN_FIRMWARE_CANEDGE;
  }

  /**
   * Calculate frame weight based on data payload length
   * Based on real MF4 size measurements:
   * - 8 bytes: 1.0 MB/min (baseline, weight = 4)
   * - 12 bytes: 1.75 MB/min (+75%, weight = 7)
   * - 16 bytes: 2.12 MB/min (+112%, weight = 8.48)
   * - 64 bytes: 4.16 MB/min (+316%, weight = 16.64)
   * Uses piecewise linear interpolation between anchor points.
   */
  calculateFrameWeight(dataLength) {
    // Anchor points based on MF4 measurements (relative to 8 bytes = 1.0)
    // 8B -> 1.0, 12B -> 1.75, 16B -> 2.12, 64B -> 4.16
    const baseWeight = 4; // Scale factor to keep weights in similar range
    
    if (dataLength <= 8) {
      return baseWeight * 1.0;
    } else if (dataLength <= 12) {
      // Interpolate between 8 (1.0) and 12 (1.75)
      const ratio = 1.0 + (dataLength - 8) * (1.75 - 1.0) / (12 - 8);
      return baseWeight * ratio;
    } else if (dataLength <= 16) {
      // Interpolate between 12 (1.75) and 16 (2.12)
      const ratio = 1.75 + (dataLength - 12) * (2.12 - 1.75) / (16 - 12);
      return baseWeight * ratio;
    } else {
      // Interpolate between 16 (2.12) and 64 (4.16)
      const ratio = 2.12 + (dataLength - 16) * (4.16 - 2.12) / (64 - 16);
      return baseWeight * ratio;
    }
  }

  parseCsvFile(csvContent) {
    try {
      this.setState({ isLoading: true });

      const result = parseCanFrameCsv(csvContent);

      if (result.error) {
        this.props.showAlert("danger", result.error);
        this.setState({ isLoading: false });
        return;
      }

      const frames = result.frames;

      if (frames.length === 0) {
        this.props.showAlert("warning", "No frames found in CSV file");
        this.setState({ isLoading: false });
        return;
      }

      // Store raw frames for filter evaluation
      this.rawFrames = frames;

      // Calculate time delta for rate calculations
      const firstTimestamp = frames[0].timestamp;
      const lastTimestamp = frames[frames.length - 1].timestamp;
      const timeDeltaSeconds = lastTimestamp - firstTimestamp;

      // Build map of unique channel & ID combinations with their weighted size
      const channelIdMap = new Map();
      let totalWeight = 0;

      for (const frame of frames) {
        const channelKey = `CAN${frame.busChannel}`;
        const key = `${channelKey}_${frame.id}`;
        const weight = this.calculateFrameWeight(frame.dataLength);
        totalWeight += weight;

        if (channelIdMap.has(key)) {
          const entry = channelIdMap.get(key);
          entry.count += 1;
          entry.totalWeight += weight;
        } else {
          channelIdMap.set(key, {
            channel: channelKey,
            id: frame.id,
            idInt: parseInt(frame.id, 16),
            count: 1,
            totalWeight: weight,
            dataLength: frame.dataLength,
            selected: false
          });
        }
      }

      // Convert map to array and calculate percentages
      const entries = Array.from(channelIdMap.values()).map((entry, index) => ({
        ...entry,
        uniqueId: index,
        percentage: (entry.totalWeight / totalWeight) * 100
      }));

      // Sort by percentage (descending)
      entries.sort((a, b) => b.percentage - a.percentage);

      // Calculate summary statistics
      const uniqueEntries = entries.length;
      const framesPerSecond = timeDeltaSeconds > 0 ? frames.length / timeDeltaSeconds : 0;
      // MB/min based on actual CSV file size
      const csvFileSizeBytes = this.csvFileSize || 0;
      const mbPerMin = timeDeltaSeconds > 0 ? (csvFileSizeBytes / (1024 * 1024)) / (timeDeltaSeconds / 60) : 0;
      // Calculate average data length for MF4/CSV ratio estimation
      const totalDataLength = frames.reduce((sum, f) => sum + (f.dataLength || 0), 0);
      const avgDataLength = frames.length > 0 ? totalDataLength / frames.length : 8;

      // Calculate IDs per channel
      const channelStats = new Map();
      for (const entry of entries) {
        if (!channelStats.has(entry.channel)) {
          channelStats.set(entry.channel, { total: 0, is29Bit: 0 });
        }
        const stats = channelStats.get(entry.channel);
        stats.total += 1;
        if (entry.idInt > 0x7FF) {
          stats.is29Bit += 1;
        }
      }

      const csvData = {
        entries,
        totalFrames: frames.length,
        totalWeight,
        uniqueEntries,
        framesPerSecond,
        mbPerMin,
        timeDeltaSeconds,
        channelStats,
        avgDataLength
      };

      this.setState({ csvData, isLoading: false }, () => {
        this.mergeData();
      });

      this.props.showAlert("success", `Loaded ${frames.length} frames`);
    } catch (e) {
      this.props.showAlert("danger", "Error parsing CSV file: " + e.message);
      this.setState({ isLoading: false });
    }
  }

  handleCsvUpload(file) {
    try {
      if (file && file.length > 0) {
        const maxSizeMB = 50;
        const maxSizeBytes = maxSizeMB * 1024 * 1024;
        if (file[0].size > maxSizeBytes) {
          this.props.showAlert("warning", `CSV file exceeds ${maxSizeMB} MB limit`);
          return;
        }
        // Clear previous CSV data before loading new file
        this.rawFrames = [];
        this.csvFileSize = file[0].size;
        this.setState({ 
          csvFileName: file[0].name, 
          showFilteredSummary: false,
          csvData: null,
          filteredCsvData: null,
          filterReductionPercent: 0,
          mergedEntries: []
        });
        this.csvFileReader.readAsText(file[0]);
      }
    } catch (e) {
      this.props.showAlert("danger", "Failed to load CSV file: " + e.message);
      this.setState({ isLoading: false });
    }
  }

  /**
   * Evaluate CSV data with current filter settings from Configuration File
   */
  evaluateWithFilters() {
    if (!this.rawFrames || this.rawFrames.length === 0) {
      this.props.showAlert("warning", "No CSV data loaded");
      return null;
    }

    // Get current configuration from props
    const configData = this.props.formData;
    if (!configData) {
      this.props.showAlert("warning", "No configuration file loaded");
      return null;
    }

    try {
      const { filteredFrames, stats, reductionPercent } = evaluateFilters(this.rawFrames, configData, this.props.detectedDeviceType);

      if (filteredFrames.length === 0) {
        // All frames filtered out
        return {
          csvData: {
            entries: [],
            totalFrames: 0,
            totalWeight: 0,
            uniqueEntries: 0,
            framesPerSecond: 0,
            mbPerMin: 0,
            timeDeltaSeconds: this.state.csvData?.timeDeltaSeconds || 0,
            channelStats: new Map()
          },
          reductionPercent
        };
      }

      // Calculate time delta for rate calculations
      const firstTimestamp = filteredFrames[0].timestamp;
      const lastTimestamp = filteredFrames[filteredFrames.length - 1].timestamp;
      const timeDeltaSeconds = lastTimestamp - firstTimestamp;

      // Build map of unique channel & ID combinations with their weighted size
      const channelIdMap = new Map();
      let totalWeight = 0;

      for (const frame of filteredFrames) {
        const channelKey = `CAN${frame.busChannel}`;
        const key = `${channelKey}_${frame.id}`;
        const weight = this.calculateFrameWeight(frame.dataLength);
        totalWeight += weight;

        if (channelIdMap.has(key)) {
          const entry = channelIdMap.get(key);
          entry.count += 1;
          entry.totalWeight += weight;
        } else {
          channelIdMap.set(key, {
            channel: channelKey,
            id: frame.id,
            idInt: parseInt(frame.id, 16),
            count: 1,
            totalWeight: weight,
            dataLength: frame.dataLength,
            selected: false
          });
        }
      }

      // Convert map to array and calculate percentages
      const entries = Array.from(channelIdMap.values()).map((entry, index) => ({
        ...entry,
        uniqueId: index,
        percentage: totalWeight > 0 ? (entry.totalWeight / totalWeight) * 100 : 0
      }));

      // Sort by percentage (descending)
      entries.sort((a, b) => b.percentage - a.percentage);

      // Calculate summary statistics
      const uniqueEntries = entries.length;
      const framesPerSecond = timeDeltaSeconds > 0 ? filteredFrames.length / timeDeltaSeconds : 0;
      // Estimate filtered file size based on reduction
      const filteredFileSize = this.csvFileSize * (1 - reductionPercent / 100);
      const mbPerMin = timeDeltaSeconds > 0 ? (filteredFileSize / (1024 * 1024)) / (timeDeltaSeconds / 60) : 0;
      // Calculate average data length for MF4/CSV ratio estimation
      const totalDataLength = filteredFrames.reduce((sum, f) => sum + (f.dataLength || 0), 0);
      const avgDataLength = filteredFrames.length > 0 ? totalDataLength / filteredFrames.length : 8;

      // Calculate IDs per channel
      const channelStats = new Map();
      for (const entry of entries) {
        if (!channelStats.has(entry.channel)) {
          channelStats.set(entry.channel, { total: 0, is29Bit: 0 });
        }
        const channelStat = channelStats.get(entry.channel);
        channelStat.total += 1;
        if (entry.idInt > 0x7FF) {
          channelStat.is29Bit += 1;
        }
      }

      return {
        csvData: {
          entries,
          totalFrames: filteredFrames.length,
          totalWeight,
          uniqueEntries,
          framesPerSecond,
          mbPerMin,
          timeDeltaSeconds,
          channelStats,
          avgDataLength
        },
        reductionPercent,
        filteredFileSize
      };
    } catch (e) {
      this.props.showAlert("danger", "Error evaluating filters: " + e.message);
      return null;
    }
  }

  /**
   * Toggle filtered summary view
   */
  toggleFilteredSummary() {
    const { showFilteredSummary, csvData } = this.state;

    if (!csvData) {
      this.props.showAlert("warning", "Please load a CSV file first");
      return;
    }

    if (!showFilteredSummary) {
      // Turning on - evaluate with current filters
      const result = this.evaluateWithFilters();
      if (result) {
        this.setState({
          showFilteredSummary: true,
          filteredCsvData: result.csvData,
          filterReductionPercent: result.reductionPercent
        }, () => {
          this.mergeData();
        });
      }
    } else {
      // Turning off - revert to original data
      this.setState({
        showFilteredSummary: false,
        filteredCsvData: null,
        filterReductionPercent: 0
      }, () => {
        this.mergeData();
      });
    }
  }

  handleDbcUpload(files) {
    try {
      if (!files || files.length === 0) return;

      this.pendingDbcFiles = [];
      this.dbcFilesLoaded = 0;
      this.dbcFilesErrored = 0;
      const fileNames = files.map(f => f.name);

      this.setState({ dbcFileNames: fileNames, isLoading: true });

      // Read all DBC files
      for (const file of files) {
        const reader = new FileReader();
        reader.onload = (event) => {
          this.pendingDbcFiles.push({
            name: file.name,
            content: event.target.result
          });
          this.dbcFilesLoaded++;

          if (this.dbcFilesLoaded + this.dbcFilesErrored === files.length) {
            this.processDbcFiles();
          }
        };
        reader.onerror = (event) => {
          this.dbcFilesErrored++;
          this.props.showAlert("warning", `Failed to read DBC file '${file.name}': ${event.target.error?.message || "Unknown error"}`);
          
          if (this.dbcFilesLoaded + this.dbcFilesErrored === files.length) {
            if (this.pendingDbcFiles.length > 0) {
              this.processDbcFiles();
            } else {
              this.setState({ isLoading: false });
            }
          }
        };
        reader.readAsText(file);
      }
    } catch (e) {
      this.props.showAlert("danger", "Failed to load DBC file(s): " + e.message);
      this.setState({ isLoading: false });
    }
  }

  processDbcFiles() {
    try {
      const dbcData = parseDbcFiles(this.pendingDbcFiles);

      // Show warning for files without valid prefix
      if (dbcData.hasWarnings) {
        const fileList = dbcData.filesWithoutPrefix.join(', ');
        this.props.showAlert(
          "warning",
          `No valid CAN channel prefix found for: ${fileList}. Specify the relevant channel via e.g. "can1-", "can2-" prefixes in the DBC file names.`
        );
      }

      this.setState({ dbcData, isLoading: false }, () => {
        this.mergeData();
      });

      const validFiles = dbcData.parsedFiles.filter(f => f.hasValidPrefix).length;
      this.props.showAlert("success", `Loaded ${validFiles} DBC file(s) with valid prefix`);
    } catch (e) {
      this.props.showAlert("danger", "Error parsing DBC files: " + e.message);
      this.setState({ isLoading: false });
    }
  }

  mergeData() {
    const { csvData, filteredCsvData, dbcData, groupJ1939Pgns, showFilteredSummary } = this.state;

    // Use filtered data if showing filtered summary, otherwise use original
    const activeCsvData = showFilteredSummary && filteredCsvData ? filteredCsvData : csvData;

    if (!activeCsvData && !dbcData) {
      this.setState({ mergedEntries: [] });
      return;
    }

    let entries = activeCsvData ? activeCsvData.entries.map(entry => ({ ...entry })) : [];
    const dbcMessages = dbcData ? dbcData.allMessages : new Map();
    const channelJ1939Map = dbcData ? dbcData.channelJ1939Map : new Map();

    // Match CSV entries with DBC messages
    for (const entry of entries) {
      const match = findDbcMatch(entry.channel, entry.id, dbcMessages, channelJ1939Map);
      if (match) {
        entry.messageName = match.name;
        entry.messageComment = match.comment;
        entry.signals = match.signals;
        entry.isJ1939 = match.isJ1939;
        entry.matchedDbcKey = `${match.channel}_${match.idHex}`;
        entry.dbcLength = match.length;
        entry.lengthMismatch = entry.dataLength !== undefined && match.length !== undefined && entry.dataLength !== match.length;
      } else {
        entry.messageName = '';
        entry.messageComment = '';
        entry.signals = [];
        entry.isJ1939 = false;
        entry.matchedDbcKey = null;
        entry.dbcLength = null;
        entry.lengthMismatch = false;
      }

      // Calculate PGN for 29-bit IDs
      if (entry.idInt > 0x7FF) {
        entry.pgn = extractPgn(entry.idInt);
      }

      // Build search string for filtering (include MATCH_TRUE/MATCH_FALSE for searching)
      entry.searchString = [
        entry.channel,
        entry.id,
        entry.messageName,
        entry.messageComment,
        ...(entry.signals || []),
        entry.messageName ? 'match_true' : 'match_false'
      ].join(' ').toLowerCase();
    }

    // Add DBC-only entries (not in CSV)
    if (dbcData) {
      const csvKeys = new Set(entries.map(e => e.matchedDbcKey).filter(Boolean));

      for (const [key, msg] of dbcMessages) {
        if (!csvKeys.has(key)) {
          // Check if any CSV entry matched this DBC entry via J1939
          const alreadyMatched = entries.some(e => e.matchedDbcKey === key);
          if (alreadyMatched) continue;

          entries.push({
            uniqueId: `dbc_${key}`,
            channel: msg.channel,
            id: msg.idHex,
            idInt: msg.id,
            count: 0,
            totalWeight: 0,
            percentage: null, // N/A
            dataLength: null,
            dbcLength: msg.length,
            lengthMismatch: false,
            messageName: msg.name,
            messageComment: msg.comment,
            signals: msg.signals,
            isJ1939: msg.isJ1939,
            selected: false,
            fromDbcOnly: true,
            searchString: [
              msg.channel,
              msg.idHex,
              msg.name,
              msg.comment,
              ...(msg.signals || []),
              'no_data' // DBC-only entries have no data in CSV
            ].join(' ').toLowerCase()
          });
        }
      }
    }

    // Group all 29-bit IDs by J1939 PGN if enabled
    if (groupJ1939Pgns) {
      const pgnGroups = new Map();
      const non29BitEntries = [];

      for (const entry of entries) {
        // Check if this is a 29-bit ID (regardless of DBC J1939 flag)
        const is29Bit = entry.idInt > 0x7FF;

        if (is29Bit) {
          // Calculate PGN if not already set
          const pgn = entry.pgn !== undefined ? entry.pgn : extractPgn(entry.idInt);
          const groupKey = `${entry.channel}_PGN${pgn.toString(16).toUpperCase()}`;

          if (!pgnGroups.has(groupKey)) {
            pgnGroups.set(groupKey, {
              ...entry,
              pgn,
              groupedIds: [entry.id],
              groupedCount: entry.count || 0,
              groupedPercentage: entry.percentage || 0,
              isGroup: true
            });
          } else {
            const group = pgnGroups.get(groupKey);
            group.groupedIds.push(entry.id);
            group.groupedCount += entry.count || 0;
            group.groupedPercentage += entry.percentage || 0;
          }
        } else {
          non29BitEntries.push(entry);
        }
      }

      entries = [...Array.from(pgnGroups.values()), ...non29BitEntries];
      entries.sort((a, b) => (b.groupedPercentage || b.percentage || 0) - (a.groupedPercentage || a.percentage || 0));
    }

    this.setState({ mergedEntries: entries });
  }

  handleSearchChange(e) {
    this.setState({ searchQuery: e.target.value });
  }

  handleEntryToggle(uniqueId) {
    this.setState(prevState => {
      const mergedEntries = prevState.mergedEntries.map(entry =>
        entry.uniqueId === uniqueId ? { ...entry, selected: !entry.selected } : entry
      );
      return { mergedEntries };
    }, () => {
      // Regenerate filter config if any entries are selected
      if (this.state.mergedEntries.some(e => e.selected)) {
        this.generateFilterConfig();
      } else {
        this.setState({ generatedFilterConfig: {}, mergedConfig: {}, mergedConfigValid: "Unknown" });
      }
    });
  }

  selectTop(count) {
    const filteredEntries = this.getFilteredEntries();
    // Get top N entries by percentage, excluding NO_DATA entries (fromDbcOnly)
    // Only select from entries with MATCH_TRUE or MATCH_FALSE
    // For CANmod, also exclude entries from invalid channels
    const dataEntries = filteredEntries.filter(e => 
      !e.fromDbcOnly && 
      (this.props.deviceType !== "CANmod" || this.isChannelValid(e.channel))
    );
    const topIds = new Set(dataEntries.slice(0, count).map(e => e.uniqueId));
    
    this.setState(prevState => {
      const mergedEntries = prevState.mergedEntries.map(entry =>
        ({ ...entry, selected: topIds.has(entry.uniqueId) })
      );
      return { mergedEntries };
    }, () => {
      if (this.state.mergedEntries.some(e => e.selected)) {
        this.generateFilterConfig();
      } else {
        this.setState({ generatedFilterConfig: {}, mergedConfig: {}, mergedConfigValid: "Unknown" });
      }
    });
  }

  selectMatched(matched) {
    const filteredEntries = this.getFilteredEntries();
    // Select entries based on match status
    // Matched = has messageName AND not fromDbcOnly (MATCH_TRUE)
    // Unmatched = no messageName AND not fromDbcOnly (MATCH_FALSE)
    // For CANmod, also exclude entries from invalid channels
    const matchedIds = new Set(
      filteredEntries
        .filter(e => !e.fromDbcOnly && 
          (matched ? e.messageName : !e.messageName) &&
          (this.props.deviceType !== "CANmod" || this.isChannelValid(e.channel)))
        .map(e => e.uniqueId)
    );
    
    this.setState(prevState => {
      const mergedEntries = prevState.mergedEntries.map(entry =>
        ({ ...entry, selected: matchedIds.has(entry.uniqueId) })
      );
      return { mergedEntries };
    }, () => {
      if (this.state.mergedEntries.some(e => e.selected)) {
        this.generateFilterConfig();
      } else {
        this.setState({ generatedFilterConfig: {}, mergedConfig: {}, mergedConfigValid: "Unknown" });
      }
    });
  }

  handleMasterToggle() {
    const filteredEntries = this.getFilteredEntries();
    // For CANmod, only consider entries from valid channels
    const selectableEntries = this.props.deviceType === "CANmod" 
      ? filteredEntries.filter(e => this.isChannelValid(e.channel))
      : filteredEntries;
    const allSelected = selectableEntries.length > 0 && selectableEntries.every(e => e.selected);

    this.setState(prevState => {
      const selectableIds = new Set(selectableEntries.map(e => e.uniqueId));
      const mergedEntries = prevState.mergedEntries.map(entry =>
        selectableIds.has(entry.uniqueId) ? { ...entry, selected: !allSelected } : entry
      );
      return { mergedEntries };
    }, () => {
      // Regenerate filter config if any entries are selected
      if (this.state.mergedEntries.some(e => e.selected)) {
        this.generateFilterConfig();
      } else {
        this.setState({ generatedFilterConfig: {}, mergedConfig: {}, mergedConfigValid: "Unknown" });
      }
    });
  }

  getFilteredEntries() {
    const { mergedEntries, searchQuery } = this.state;
    if (!searchQuery.trim()) return mergedEntries;

    const query = searchQuery.toLowerCase();
    return mergedEntries.filter(entry => entry.searchString.includes(query));
  }

  /**
   * Generate filter configuration from selected entries
   */
  generateFilterConfig() {
    const { mergedEntries, groupJ1939Pgns, filterType, prescalerType, prescalerValue, dataPrescalerMask } = this.state;

    // Get selected entries
    const selectedEntries = mergedEntries.filter(e => e.selected);
    if (selectedEntries.length === 0) {
      this.props.showAlert("warning", "Please select at least one entry to generate filters");
      return null;
    }

    // Group by channel
    const channelGroups = {};
    for (const entry of selectedEntries) {
      const channel = entry.channel; // e.g., "CAN1"
      if (!channelGroups[channel]) {
        channelGroups[channel] = [];
      }
      channelGroups[channel].push(entry);
    }

    const isCanmodRouter = this.props.deviceType === "CANmod" && this.isCanmodRouter();

    // Validate filter limits per channel
    for (const [channel, entries] of Object.entries(channelGroups)) {
      if (isCanmodRouter) {
        // CANmod.router: 32 total filters per channel (regardless of bit type)
        const totalFilters = entries.length;
        if (totalFilters > MAX_FILTERS_CANMOD_ROUTER) {
          this.props.showAlert("warning", `${channel}: Too many filters (${totalFilters}). Maximum is ${MAX_FILTERS_CANMOD_ROUTER} per channel.`);
          return null;
        }
        // Validate channel is valid for current channel mapping
        if (!this.isChannelValid(channel)) {
          const validChannels = this.getValidChannels().join(", ");
          this.props.showAlert("warning", `${channel} is not valid for this CANmod.router configuration. Valid channels: ${validChannels}`);
          return null;
        }
      } else {
        // CANedge: separate limits for 11-bit and 29-bit
        let count11Bit = 0;
        let count29Bit = 0;

        for (const entry of entries) {
          if (entry.isGroup && entry.groupedIds) {
            count29Bit += 1;
          } else if (entry.idInt > 0x7FF) {
            count29Bit += 1;
          } else {
            count11Bit += 1;
          }
        }

        if (count11Bit > MAX_11BIT_FILTERS_CANEDGE) {
          this.props.showAlert("warning", `${channel}: Too many 11-bit filters (${count11Bit}). Maximum is ${MAX_11BIT_FILTERS_CANEDGE}.`);
          return null;
        }
        if (count29Bit > MAX_29BIT_FILTERS_CANEDGE) {
          this.props.showAlert("warning", `${channel}: Too many 29-bit filters (${count29Bit}). Maximum is ${MAX_29BIT_FILTERS_CANEDGE}.`);
          return null;
        }
      }
    }

    // Build filter config
    const filterConfig = {};

    // Get channel mapping based on device type
    let channelToConfigKey;
    if (isCanmodRouter) {
      channelToConfigKey = this.getChannelMapping();
    } else {
      channelToConfigKey = {
        "CAN1": "can_1",
        "CAN2": "can_2",
        "CAN9": "can_internal"
      };
    }

    for (const [channel, entries] of Object.entries(channelGroups)) {
      const configKey = channelToConfigKey[channel];
      if (!configKey) continue;

      const filters = [];

      for (const entry of entries) {
        // Determine prescaler settings
        let prescaler_type = 0;
        let prescaler_value = undefined;

        // Determine filter type value (0 = acceptance, 1 = rejection)
        const filterTypeValue = filterType === "rejection" ? 1 : 0;

        if (prescalerType === "count") {
          prescaler_type = 1;
          prescaler_value = Math.min(Math.max(1, prescalerValue), 256);
        } else if (prescalerType === "time") {
          prescaler_type = 2;
          prescaler_value = Math.min(Math.max(1, prescalerValue), 4194304);
        } else if (prescalerType === "data") {
          prescaler_type = 3;
          prescaler_value = dataPrescalerMask || "";
        }

        if (entry.isGroup && groupJ1939Pgns && entry.groupedIds) {
          // J1939 PGN group - use mask method
          const pgn = entry.pgn || extractPgn(entry.idInt);
          const isPdu1 = (pgn & 0xFF00) < 0xF000;

          // For mask method: f1 = filter ID, f2 = mask
          // PDU1: mask 3FF0000 (ignores destination + source)
          // PDU2: mask 3FFFF00 (ignores source only)
          const mask = isPdu1 ? "3FF0000" : "3FFFF00";
          const filterId = isPdu1
            ? ((pgn & 0x3FF00) << 8).toString(16).toUpperCase()
            : (pgn << 8).toString(16).toUpperCase();

          const filter = {
            name: (entry.messageName || `PGN ${pgn.toString(16).toUpperCase()}`).substring(0, 16),
            state: 1,
            type: filterTypeValue,
            id_format: 1, // Extended (29-bit)
            method: 1, // Mask
            f1: filterId,
            f2: mask,
            prescaler_type: prescaler_type
          };

          if (prescaler_value !== undefined) {
            filter.prescaler_value = prescaler_value;
          }

          filters.push(filter);
        } else if (isCanmodRouter) {
          // CANmod.router: use mask method only (no range support)
          // For exact ID match: f1 = ID, f2 = 7FF (11-bit) or 1FFFFFFF (29-bit)
          // CANmod.router uses different filter structure: frame_format instead of method/type
          const isExtended = entry.idInt > 0x7FF;
          const idHex = parseInt(entry.id, 16).toString(16).toUpperCase(); // Normalize ID

          const filter = {
            name: (entry.messageName || idHex).substring(0, 16),
            state: 1,
            id_format: isExtended ? 1 : 0,
            frame_format: 2, // 2 = Both (CAN + CAN FD)
            f1: idHex,
            f2: isExtended ? "1FFFFFFF" : "7FF", // Full mask for exact match
            prescaler_type: prescaler_type
          };

          if (prescaler_value !== undefined) {
            filter.prescaler_value = prescaler_value;
          }

          filters.push(filter);
        } else {
          // CANedge: Individual ID - use range method
          const isExtended = entry.idInt > 0x7FF;
          const idHex = entry.id.toUpperCase();

          const filter = {
            name: (entry.messageName || idHex).substring(0, 16),
            state: 1,
            type: filterTypeValue,
            id_format: isExtended ? 1 : 0,
            method: 0, // Range
            f1: idHex,
            f2: idHex,
            prescaler_type: prescaler_type
          };

          if (prescaler_value !== undefined) {
            filter.prescaler_value = prescaler_value;
          }

          filters.push(filter);
        }
      }

      if (isCanmodRouter) {
        // CANmod.router: filter is a direct array under phy.can_sX.filter
        if (!filterConfig.phy) {
          filterConfig.phy = {};
        }
        filterConfig.phy[configKey] = {
          filter: filters
        };
      } else {
        // CANedge: filter.id is an array under can_X.filter.id
        filterConfig[configKey] = {
          filter: {
            id: filters
          }
        };
      }
    }

    this.setState({ generatedFilterConfig: filterConfig }, () => {
      this.testMergedFile();
    });

    return filterConfig;
  }

  /**
   * Test merged file for validation
   */
  testMergedFile() {
    const { generatedFilterConfig, filterMergeMode } = this.state;
    const { formData } = this.props;

    if (!formData || Object.keys(generatedFilterConfig).length === 0) {
      return;
    }

    let mergedConfigTemp;

    if (filterMergeMode === "replace") {
      // Replace: overwrite existing filters
      const overwriteMerge = (destinationArray, sourceArray, options) => sourceArray;
      mergedConfigTemp = merge(formData, generatedFilterConfig, {
        arrayMerge: overwriteMerge,
      });
    } else if (filterMergeMode === "append_top") {
      // Append top: new filters at the beginning
      const appendTopMerge = (destinationArray, sourceArray, options) => [...sourceArray, ...destinationArray];
      mergedConfigTemp = merge(formData, generatedFilterConfig, {
        arrayMerge: appendTopMerge,
      });
    } else {
      // Append bottom: new filters at the end
      const appendBottomMerge = (destinationArray, sourceArray, options) => [...destinationArray, ...sourceArray];
      mergedConfigTemp = merge(formData, generatedFilterConfig, {
        arrayMerge: appendBottomMerge,
      });
    }

    this.setState({ mergedConfig: mergedConfigTemp }, () => {
      if (yourForm) {
        yourForm.submit();
      }
    });
  }

  onSubmit() {
    this.setState({ mergedConfigValid: true });
  }

  onValidationError() {
    this.setState({ mergedConfigValid: false });
  }

  /**
   * Validate that combined filter counts (existing + new) don't exceed limits
   */
  validateCombinedFilterLimits() {
    const { generatedFilterConfig, filterMergeMode } = this.state;
    const { formData } = this.props;
    const isCanmodRouter = this.isCanmodRouter();

    if (!formData || Object.keys(generatedFilterConfig).length === 0) {
      return { valid: true };
    }

    // If replacing, we only need to check the new filters (already validated in generateFilterConfig)
    if (filterMergeMode === "replace") {
      return { valid: true };
    }

    const errors = [];

    if (isCanmodRouter) {
      // CANmod.router: filters are in phy.can_sX.filter (direct array)
      // 32 total filters per channel regardless of bit type
      const channelMapping = this.getChannelMapping();
      
      for (const [csvChannel, configKey] of Object.entries(channelMapping)) {
        // Count existing filters
        let existingCount = 0;
        if (formData.phy?.[configKey]?.filter && Array.isArray(formData.phy[configKey].filter)) {
          existingCount = formData.phy[configKey].filter.length;
        }

        // Count new filters
        let newCount = 0;
        if (generatedFilterConfig.phy?.[configKey]?.filter && Array.isArray(generatedFilterConfig.phy[configKey].filter)) {
          newCount = generatedFilterConfig.phy[configKey].filter.length;
        }

        const totalCount = existingCount + newCount;
        if (totalCount > MAX_FILTERS_CANMOD_ROUTER) {
          errors.push(`${csvChannel}: Combined filters (${existingCount} existing + ${newCount} new = ${totalCount}) exceeds limit of ${MAX_FILTERS_CANMOD_ROUTER}`);
        }
      }
    } else {
      // CANedge: filters are in can_X.filter.id
      const channelToConfigKey = {
        "CAN1": "can_1",
        "CAN2": "can_2",
        "CAN9": "can_internal"
      };

      for (const [channel, configKey] of Object.entries(channelToConfigKey)) {
        // Count existing filters in formData
        let existing11Bit = 0;
        let existing29Bit = 0;

        if (formData[configKey] && formData[configKey].filter && formData[configKey].filter.id) {
          for (const filter of formData[configKey].filter.id) {
            if (filter.id_format === 1) {
              existing29Bit++;
            } else {
              existing11Bit++;
            }
          }
        }

        // Count new filters in generatedFilterConfig
        let new11Bit = 0;
        let new29Bit = 0;

        if (generatedFilterConfig[configKey] && generatedFilterConfig[configKey].filter && generatedFilterConfig[configKey].filter.id) {
          for (const filter of generatedFilterConfig[configKey].filter.id) {
            if (filter.id_format === 1) {
              new29Bit++;
            } else {
              new11Bit++;
            }
          }
        }

        const total11Bit = existing11Bit + new11Bit;
        const total29Bit = existing29Bit + new29Bit;

        if (total11Bit > MAX_11BIT_FILTERS_CANEDGE) {
          errors.push(`${channel}: Combined 11-bit filters (${existing11Bit} existing + ${new11Bit} new = ${total11Bit}) exceeds limit of ${MAX_11BIT_FILTERS_CANEDGE}`);
        }
        if (total29Bit > MAX_29BIT_FILTERS_CANEDGE) {
          errors.push(`${channel}: Combined 29-bit filters (${existing29Bit} existing + ${new29Bit} new = ${total29Bit}) exceeds limit of ${MAX_29BIT_FILTERS_CANEDGE}`);
        }
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true };
  }

  /**
   * Remove duplicate filter entries from arrays, keeping top entries and removing from bottom.
   * Two entries are duplicates if all fields match except 'name'.
   */
  removeDuplicateFilters(config) {
    let totalDuplicatesRemoved = 0;
    const isCanmodRouter = this.isCanmodRouter();

    if (isCanmodRouter) {
      // CANmod.router: filters are in phy.can_sX.filter (direct array)
      const channels = ["can_s1", "can_s2", "can_s3", "can_s4"];

      for (const channel of channels) {
        if (config.phy?.[channel]?.filter && Array.isArray(config.phy[channel].filter)) {
          const filters = config.phy[channel].filter;
          const seen = new Set();
          const uniqueFilters = [];

          for (const filter of filters) {
            const { name, ...fieldsWithoutName } = filter;
            const key = JSON.stringify(fieldsWithoutName);

            if (!seen.has(key)) {
              seen.add(key);
              uniqueFilters.push(filter);
            } else {
              totalDuplicatesRemoved++;
            }
          }

          config.phy[channel].filter = uniqueFilters;
        }
      }
    } else {
      // CANedge: filters are in can_X.filter.id
      const channels = ["can_1", "can_2", "can_internal"];

      for (const channel of channels) {
        if (config[channel] && config[channel].filter && config[channel].filter.id) {
          const filters = config[channel].filter.id;
          const seen = new Set();
          const uniqueFilters = [];

          for (const filter of filters) {
            const { name, ...fieldsWithoutName } = filter;
            const key = JSON.stringify(fieldsWithoutName);

            if (!seen.has(key)) {
              seen.add(key);
              uniqueFilters.push(filter);
            } else {
              totalDuplicatesRemoved++;
            }
          }

          config[channel].filter.id = uniqueFilters;
        }
      }
    }

    return { config, duplicatesRemoved: totalDuplicatesRemoved };
  }

  onMerge() {
    const { mergedConfig, mergedConfigValid } = this.state;

    // Check schema validation first
    if (mergedConfigValid !== true) {
      console.log("Merged config that failed validation:", mergedConfig);
      this.props.showAlert("warning", "Cannot merge - the combined configuration is invalid. Check console for details.");
      return;
    }

    // Validate combined filter limits before merge
    const validation = this.validateCombinedFilterLimits();
    if (!validation.valid) {
      this.props.showAlert("warning", validation.errors[0]);
      return;
    }

    // Remove duplicate filter entries
    const { config: dedupedConfig, duplicatesRemoved } = this.removeDuplicateFilters(JSON.parse(JSON.stringify(mergedConfig)));

    this.props.setConfigContent(dedupedConfig);
    this.props.setUpdatedFormData(dedupedConfig);

    if (duplicatesRemoved > 0) {
      this.props.showAlert("warning", `Merged filter configuration with Configuration File - ${duplicatesRemoved} duplicate entries removed`);
    } else {
      this.props.showAlert("success", "Merged filter configuration with Configuration File");
    }
  }

  onDownload() {
    const { generatedFilterConfig } = this.state;

    const dataStr = JSON.stringify(generatedFilterConfig, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const exportFileDefaultName = 'filter-config.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  }

  renderBarChart(percentage, maxPercentage) {
    // Simple vanilla bar chart using div with background
    // Scale relative to maxPercentage so the highest bar fills the width
    const maxWidth = 25;
    const barWidth = Math.max(1, (percentage / maxPercentage) * maxWidth);

    return (
      <div
        style={{
          width: `${barWidth}px`,
          height: "10px",
          backgroundColor: "#4a90d9",
          borderRadius: "2px",
          display: "inline-block"
        }}
      />
    );
  }

  render() {
    const { csvFileName, dbcFileNames, csvData, mergedEntries, searchQuery, groupJ1939Pgns, isLoading } = this.state;

    const filteredEntries = this.getFilteredEntries();
    const allFilteredSelected = filteredEntries.length > 0 && filteredEntries.every(e => e.selected);

    // Calculate max percentage for bar scaling - consider both individual and grouped entries
    const allPercentages = filteredEntries
      .map(e => e.isGroup ? e.groupedPercentage : e.percentage)
      .filter(p => p !== null && p !== undefined);
    const maxPercentage = allPercentages.length > 0 ? Math.max(...allPercentages) : 100;

    return (
      <div>
        <h4>Filter builder</h4>

        {/* Warning for non-router CANmod devices */}
        {this.props.deviceType === "CANmod" && this.props.formData && Object.keys(this.props.formData).length > 0 && !this.isCanmodRouter() && (
          <div style={{ fontSize: "12px", color: "#d9534f", marginBottom: "10px" }}>
            Only supported for CANmod.router
          </div>
        )}

        {/* Evaluate log file section */}
        <div className="form-group pl0 field-string">
          <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", flexWrap: "wrap" }}>
            {/* CSV Upload */}
            <div className="file-dropzone">
              <Files
                onChange={this.handleCsvUpload}
                onError={(error) => this.props.showAlert("danger", error.message)}
                accepts={[".csv"]}
                multiple={false}
                maxFileSize={100000000}
                minFileSize={0}
                clickable
              >
                <button className="btn btn-primary">Load CSV</button>
              </Files>
            </div>

            {/* DBC Upload */}
            <div className="file-dropzone">
              <Files
                onChange={this.handleDbcUpload}
                onError={(error) => this.props.showAlert("danger", error.message)}
                accepts={[".dbc"]}
                multiple={true}
                maxFileSize={100000000}
                minFileSize={0}
                clickable
              >
                <button className="btn btn-primary">Load DBC(s)</button>
              </Files>
            </div>
          </div>
          <p className="field-description field-description-shift">
            {this.props.deviceType === "CANmod" 
              ? "Load a CSV log file output from the MF4 converter 'mdf2csv' which reflects a realistic log session with the default filters applied. The MF4 should be recorded with a CANedge with one or two CANmod.router(s) on CAN2. The CSV should be created by first demuxing the MF4 via the 'mdf2mdf' converter using the argument '--muxtp-can2=010#11:12:13:14'. If you are analyzing a second router, use --muxtp-can2=012#15:16:17:18. Recommended CSV file size is 1-10 MB. Optionally load DBC file(s) to add further details or enable filter selection based on DBC messages. DBC files must have a CAN channel prefix (e.g. can11-abc.dbc)."
              : "Load a CSV log file output from the MF4 converter 'mdf2csv' which reflects a realistic log session with the default filters applied. Recommended CSV file size is 1-10 MB. Optionally load DBC file(s) to add further details or enable filter selection based on DBC messages. DBC files must have a CAN channel prefix (e.g. can1-abc.dbc)."
            }
          </p>

          {/* Loaded file names */}
          {(csvFileName || dbcFileNames.length > 0) && (
            <div style={{ fontSize: "11px", color: "#666", marginTop: "6px" }} title={[csvFileName, ...dbcFileNames].filter(Boolean).join(', ')}>
              {[csvFileName, ...dbcFileNames].filter(Boolean).join(', ').length > 40
                ? [csvFileName, ...dbcFileNames].filter(Boolean).join(', ').substring(0, 40) + '...'
                : [csvFileName, ...dbcFileNames].filter(Boolean).join(', ')}
            </div>
          )}
        </div>

        {/* J1939 PGN Grouping checkbox - only show when CSV is loaded */}
        {csvData && (
          <div className="form-group pl0 field-string" style={{ marginTop: "10px", marginBottom: "0px" }}>
            <label style={{ display: "flex", alignItems: "center", cursor: "pointer", fontSize: "12px" }}>
              <input
                type="checkbox"
                checked={groupJ1939Pgns}
                onChange={() => {
                  this.setState({ groupJ1939Pgns: !groupJ1939Pgns }, () => {
                    this.mergeData();
                  });
                }}
                style={{ marginRight: "6px", marginBottom: "2px" }}
              />
              Group 29-bit IDs as PGNs
            </label>
            <p className="field-description field-description-shift">
              In J1939/ISOBUS/NMEA protocol use cases it can be relevant to evaluate messages at the 18-bit PGN level instead of the 29-bit ID level.
            </p>
          </div>
        )}

        {/* Show filtered summary checkbox - only show when CSV is loaded, disabled if no config or unsupported firmware */}
        {csvData && (() => {
          const isEnabled = this.props.formData && this.isFirmwareVersionSupported();
          return (
            <div className="form-group pl0 field-string" style={{ marginTop: "6px", marginBottom: "0px" }}>
              <label 
                style={{
                  display: "flex",
                  alignItems: "center",
                  cursor: isEnabled ? "pointer" : "not-allowed",
                  fontSize: "12px",
                  opacity: isEnabled ? 1 : 0.5
                }}
              >
                <input
                  type="checkbox"
                  checked={this.state.showFilteredSummary}
                  onChange={() => this.toggleFilteredSummary()}
                  disabled={!isEnabled}
                  style={{ marginRight: "6px", marginBottom: "2px" }}
                />
                Show summary with current filters
              </label>
              <p className="field-description field-description-shift">
                Click to evaluate the estimated impact of your current Configuration File filters/prescalers on the log file CSV.
              </p>
            </div>
          );
        })()}

        {/* Loading indicator */}
        {isLoading && (
          <div style={{ padding: "20px", textAlign: "center", color: "#666" }}>
            Analyzing files...
          </div>
        )}

        {/* Analysis results */}
        {(csvData || this.state.dbcData) && !isLoading && (
          <div>
            {/* Channel mapping for CANmod.router */}
            {this.props.deviceType === "CANmod" && this.isCanmodRouter() && (
              <div className="form-group pl0 field-string" style={{ marginTop: "15px", marginBottom: "10px" }}>
                <div style={{ marginBottom: "4px" }}>Channel mapping</div>
                <div 
                  style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}
                  title="Control how the demuxed CSV CAN channels map from/to the Configuration File CAN channels."
                >
                  {["S1", "S2", "S3", "S4"].map((label, idx) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ fontSize: "12px" }}>{label}:</span>
                      <input
                        type="text"
                        className="form-control encryption-input"
                        value={this.state[`channelMap${label}`]}
                        onChange={(e) => this.setState({ [`channelMap${label}`]: e.target.value })}
                        style={{ width: "36px", padding: "1px 4px", fontSize: "12px", height: "22px" }}
                      />
                    </div>
                  ))}
                </div>
                <span className="field-description field-description-shift">
                  Control how the demuxed CSV CAN channels map from/to the Configuration File CAN channels.
                </span>
              </div>
            )}

            {/* Summary statistics label */}
            <div className="form-group pl0 field-string" style={{ marginTop: "15px", marginBottom: "5px" }}>
              Summary statistics
              <span className="field-description field-description-shift">
                The summary shows the CAN channel & ID ranked by the top size contributors in your CSV file. Size contribution is based on their occurence and data length. You can select entries to add them to your Configuration File filters.
              </span>
            </div>

            {/* Search and master checkbox */}
            <div style={{ display: "flex", alignItems: "center", marginBottom: "10px" }}>
              <label className="checkbox-design" style={{ marginRight: "10px" }}>
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={this.handleMasterToggle}
                />
                <span></span>
              </label>
              <input
                type="text"
                className="form-control encryption-input"
                placeholder="Search IDs, names, signals ..."
                value={searchQuery}
                onChange={this.handleSearchChange}
                style={{ flex: 1 }}
              />
            </div>

            {/* Results table */}
            <div
              className="browse-file-preview"
              style={{
                maxHeight: "250px",
                padding: "0"
              }}
            >
              {/* Header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "5px 8px",
                  borderBottom: "2px solid #ddd",
                  backgroundColor: "#f5f5f5",
                  fontWeight: "bold",
                  fontSize: "12px",
                  position: "sticky",
                  top: 0,
                  minWidth: "fit-content",
                  zIndex: 1
                }}
              >
                <span style={{ width: "24px", flexShrink: 0 }}></span>
                <span style={{ width: "95px", flexShrink: 0 }}>ID</span>
                <span style={{ width: "58px", flexShrink: 0 }}>Name</span>
                <span style={{ width: "62px", flexShrink: 0, paddingRight: "8px" }}>Size %</span>
                <span style={{ width: "55px", flexShrink: 0, textAlign: "right" }}>Frames</span>
                <span style={{ width: "40px", flexShrink: 0, textAlign: "right", marginLeft: "8px" }}>Len</span>
                <span style={{ width: "85px", flexShrink: 0, marginLeft: "8px" }}>Comment</span>
                <span style={{ width: "70px", flexShrink: 0, marginLeft: "8px" }}>Match</span>
                <span style={{ width: "255px", flexShrink: 0, marginLeft: "8px" }}>Signals</span>
              </div>

              {/* Entries */}
              {filteredEntries.map((entry) => {
                const isChannelValid = this.props.deviceType === "CANmod" ? this.isChannelValid(entry.channel) : true;
                return (
                <div
                  key={entry.uniqueId}
                  onClick={() => isChannelValid && this.handleEntryToggle(entry.uniqueId)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "0px 8px",
                    borderBottom: "1px solid #eee",
                    fontSize: "12px",
                    cursor: isChannelValid ? "pointer" : "not-allowed",
                    backgroundColor: entry.selected ? "#e8f4fc" : (entry.fromDbcOnly ? "#f9f9f9" : "#fff"),
                    minWidth: "fit-content",
                    opacity: isChannelValid ? 1 : 0.4
                  }}
                >
                  {/* Checkbox */}
                  <span style={{ width: "24px", flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    <label className="checkbox-design">
                      <input
                        type="checkbox"
                        checked={entry.selected}
                        disabled={!isChannelValid}
                        onChange={() => isChannelValid && this.handleEntryToggle(entry.uniqueId)}
                      />
                      <span></span>
                    </label>
                  </span>

                  {/* Channel & ID */}
                  <span
                    className="binary-text-alt-2"
                    style={{
                      width: "95px",
                      flexShrink: 0,
                      fontFamily: "monospace",
                      fontSize: "11px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap"
                    }}
                    title={`${entry.channel} ${parseInt(entry.id, 16).toString(16).toUpperCase()}${entry.isGroup ? ` (+${entry.groupedIds.length - 1} more)` : ''}`}
                  >
                    {entry.channel} {parseInt(entry.id, 16).toString(16).toUpperCase()}
                  </span>

                  {/* Message Name */}
                  <span
                    style={{
                      width: "58px",
                      flexShrink: 0,
                      fontSize: "11px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap"
                    }}
                    title={entry.messageName || ''}
                  >
                    {entry.messageName || ''}
                  </span>

                  {/* Size % with bar */}
                  <span style={{ width: "62px", flexShrink: 0, display: "flex", alignItems: "center", paddingRight: "8px" }}>
                    {entry.percentage !== null || entry.isGroup ? (
                      <span style={{ display: "flex", alignItems: "center" }}>
                        {this.renderBarChart(entry.isGroup ? entry.groupedPercentage : entry.percentage, maxPercentage)}
                        <span style={{ marginLeft: "4px", fontFamily: "monospace", fontSize: "11px" }}>
                          {(entry.isGroup ? entry.groupedPercentage : entry.percentage).toFixed(1)}%
                        </span>
                      </span>
                    ) : (
                      <span style={{ color: "#999", fontSize: "11px" }}>N/A</span>
                    )}
                  </span>

                  {/* Frame count */}
                  <span style={{
                    width: "55px",
                    flexShrink: 0,
                    textAlign: "right",
                    color: "#666",
                    fontSize: "11px"
                  }}>
                    {(() => {
                      const count = entry.isGroup ? entry.groupedCount : entry.count;
                      if (count >= 1000) {
                        return (count / 1000).toFixed(count >= 10000 ? 0 : 1) + 'K';
                      }
                      return count;
                    })()}
                  </span>

                  {/* Length */}
                  <span style={{
                    width: "40px",
                    flexShrink: 0,
                    textAlign: "right",
                    marginLeft: "8px",
                    fontSize: "11px",
                    color: entry.lengthMismatch ? "#d9534f" : "#666"
                  }}>
                    {entry.lengthMismatch
                      ? `${entry.dataLength}/${entry.dbcLength}`
                      : (entry.dataLength !== null && entry.dataLength !== undefined
                        ? entry.dataLength
                        : (entry.dbcLength !== null && entry.dbcLength !== undefined
                          ? entry.dbcLength
                          : ''))}
                  </span>

                  {/* Comment */}
                  <span
                    style={{
                      width: "85px",
                      flexShrink: 0,
                      marginLeft: "8px",
                      fontSize: "11px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "#666"
                    }}
                    title={entry.messageComment || ''}
                  >
                    {entry.messageComment || ''}
                  </span>

                  {/* Match */}
                  <span
                    style={{
                      width: "70px",
                      flexShrink: 0,
                      marginLeft: "8px",
                      fontSize: "10px",
                      fontFamily: "monospace",
                      color: entry.fromDbcOnly ? "#f0ad4e" : (entry.messageName ? "#5cb85c" : "#999")
                    }}
                  >
                    {entry.fromDbcOnly ? "NO_DATA" : (entry.messageName ? "MATCH_TRUE" : "MATCH_FALSE")}
                  </span>

                  {/* Signals */}
                  <span
                    style={{
                      width: "255px",
                      flexShrink: 0,
                      marginLeft: "8px",
                      fontSize: "11px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "#666"
                    }}
                    title={entry.signals ? entry.signals.join(', ') : ''}
                  >
                    {entry.signals ? entry.signals.join(', ') : ''}
                  </span>
                </div>
              );
              })}

              {filteredEntries.length === 0 && (
                <div style={{ padding: "10px", textAlign: "center", color: "#999" }}>
                  No entries found
                </div>
              )}
            </div>

            {/* Select buttons */}
            <div style={{ fontSize: "12px", marginTop: "4px", marginBottom: "6px" }}>
              <span style={{ color: "#666" }}>Select: </span>
              <span
                style={{ color: "#337ab7", cursor: "pointer", marginLeft: "4px" }}
                onClick={() => this.selectTop(30)}
              >Top 30</span>
              <span style={{ color: "#666", margin: "0 4px" }}>|</span>
              <span
                style={{ color: "#337ab7", cursor: "pointer" }}
                onClick={() => this.selectTop(50)}
              >Top 50</span>
              <span style={{ color: "#666", margin: "0 4px" }}>|</span>
              <span
                style={{ color: "#337ab7", cursor: "pointer" }}
                onClick={() => this.selectMatched(true)}
              >Matched</span>
              <span style={{ color: "#666", margin: "0 4px" }}>|</span>
              <span
                style={{ color: "#337ab7", cursor: "pointer" }}
                onClick={() => this.selectMatched(false)}
              >Unmatched</span>
            </div>

            {/* Summary statistics */}
            {csvData && (() => {
              const activeCsvData = this.state.showFilteredSummary && this.state.filteredCsvData ? this.state.filteredCsvData : csvData;
              const isFiltered = this.state.showFilteredSummary && this.state.filteredCsvData;
              const originalFileSize = this.csvFileSize / (1024 * 1024);
              const filteredFileSize = isFiltered ? originalFileSize * (1 - this.state.filterReductionPercent / 100) : originalFileSize;

              return (
                <div style={{ fontSize: "12px", marginTop: "10px", color: "#666", lineHeight: "1.6" }}>
                  {/* Line 1: Data */}
                  <div>
                    <strong>Data:</strong> {filteredFileSize.toFixed(1)} MB | {activeCsvData.totalFrames >= 1000000 ? (activeCsvData.totalFrames / 1000000).toFixed(1) + 'M' : (activeCsvData.totalFrames >= 1000 ? (activeCsvData.totalFrames / 1000).toFixed(activeCsvData.totalFrames >= 10000 ? 0 : 1) + 'K' : activeCsvData.totalFrames)} frames | {(activeCsvData.timeDeltaSeconds / 60).toFixed(1)} min | {Math.round(activeCsvData.framesPerSecond)} FPS
                  </div>

                  {/* Line 2: IDs by channel */}
                  <div>
                    <strong>Data IDs:</strong> {activeCsvData.channelStats.size > 0 ? Array.from(activeCsvData.channelStats.entries())
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([channel, stats]) => {
                        const pgnCount = groupJ1939Pgns && stats.is29Bit > 0
                          ? mergedEntries.filter(e => e.channel === channel && !e.fromDbcOnly).length
                          : null;
                        return `${channel}: ${stats.total}${pgnCount !== null && pgnCount !== stats.total ? ` (${pgnCount} PGNs)` : ''}`;
                      }).join(' | ') : 'None'}
                  </div>

                  {/* Line 3: MB/min - ratio depends on avg data length (0.33 for 8 bytes, 0.48 for 12+ bytes) */}
                  {(() => {
                    const avgLen = activeCsvData.avgDataLength || 8;
                    // Linear interpolation: 8 bytes -> 0.33, 12+ bytes -> 0.48
                    const mf4Ratio = avgLen <= 8 ? 0.33 : (avgLen >= 12 ? 0.48 : 0.33 + (avgLen - 8) * (0.48 - 0.33) / (12 - 8));
                    const mfcRatio = mf4Ratio * 0.5;
                    return (
                      <div>
                        <strong>MB/min:</strong> CSV: {activeCsvData.mbPerMin.toFixed(1)} | MF4: ~{(activeCsvData.mbPerMin * mf4Ratio).toFixed(1)} | MFC: ~{(activeCsvData.mbPerMin * mfcRatio).toFixed(1)}
                      </div>
                    );
                  })()}

                  {/* Filtered indicator - below stats */}
                  {isFiltered && (
                    <div style={{ color: "#5cb85c", marginTop: "4px" }}>
                      Showing filtered summary (reduction: <strong>{this.state.filterReductionPercent.toFixed(1)}%</strong>)
                    </div>
                  )}

                </div>
              );
            })()}

            {/* Add Filters Section - always visible when data loaded, grayed out when no selection */}
            {(() => {
              const hasSelection = mergedEntries.some(e => e.selected);
              return (
                <div style={{ marginTop: "15px", opacity: hasSelection ? 1 : 0.5, pointerEvents: hasSelection ? "auto" : "none" }}>
                  {/* Horizontal divider */}
                  <hr style={{ border: "none", borderTop: "1px solid #ddd", margin: "15px 0" }} />

                  <div className="form-group pl0 field-string">
                    Add filters
                    <span className="field-description field-description-shift">
                      Select channel &amp; ID entries and add them as filters to your Configuration File (channels with no selections are unaffected).
                    </span>
                  </div>

                  {/* Type and Prescaler dropdowns - same row */}
                  <div className="row">
                    <div className="col-xs-6" style={{ opacity: this.props.deviceType === "CANmod" ? 0.5 : 1, pointerEvents: this.props.deviceType === "CANmod" ? "none" : "auto" }}>
                      <SimpleDropdown
                        name="Type"
                        options={[
                          { value: "acceptance", label: "Acceptance" },
                          { value: "rejection", label: "Rejection" }
                        ]}
                        value={this.state.filterType}
                        onChange={(opt) => this.setState({ filterType: opt.value }, () => this.generateFilterConfig())}
                      />
                      {this.props.deviceType === "CANmod" && (
                        <span className="field-description" style={{ fontSize: "11px", color: "#999" }}>CANmod only supports acceptance filters</span>
                      )}
                    </div>
                    {this.state.filterType === "acceptance" && (
                      <div className="col-xs-6">
                        <SimpleDropdown
                          name="Prescaler"
                          options={prescalerOptions}
                          value={this.state.prescalerType}
                          onChange={(opt) => this.setState({ prescalerType: opt.value }, () => this.generateFilterConfig())}
                        />
                      </div>
                    )}
                  </div>

                  {/* Prescaler value input - below dropdowns */}
                  {this.state.filterType === "acceptance" && this.state.prescalerType !== "none" && (
                    <div className="form-group pl0 field-string">
                      {this.state.prescalerType === "count" && "Count value"}
                      {this.state.prescalerType === "time" && "Time interval (ms)"}
                      {this.state.prescalerType === "data" && "Data mask (hex)"}
                      {(this.state.prescalerType === "count" || this.state.prescalerType === "time") && (
                        <input
                          type="number"
                          className="form-control encryption-input"
                          min="1"
                          max={this.state.prescalerType === "count" ? 256 : 4194304}
                          value={this.state.prescalerValue}
                          onChange={(e) => this.setState({ prescalerValue: parseInt(e.target.value) || 1 }, () => this.generateFilterConfig())}
                        />
                      )}
                      {this.state.prescalerType === "data" && (
                        <input
                          type="text"
                          className="form-control encryption-input"
                          value={this.state.dataPrescalerMask}
                          onChange={(e) => {
                            const val = e.target.value.toUpperCase();
                            if (/^[a-fA-F0-9]*$/.test(val) && val.length <= 16) {
                              this.setState({ dataPrescalerMask: val }, () => this.generateFilterConfig());
                            }
                          }}
                          placeholder=""
                          title="Example: Blank matches all bytes, FF matches 8 bytes, FFFFFFFF matches 64 bytes"
                          style={{ fontFamily: "monospace" }}
                        />
                      )}
                      <span className="field-description field-description-shift">
                        {this.state.prescalerType === "count" && "Accept every Nth message (1-256)"}
                        {this.state.prescalerType === "time" && "Minimum time between messages (1-4194304 ms)"}
                        {this.state.prescalerType === "data" && "Hex mask for data change detection"}
                      </span>
                    </div>
                  )}

                  {/* Merge mode radio buttons - single line with reduced gap */}
                  <div 
                    style={{ display: "flex", alignItems: "center", marginBottom: "15px", gap: "10px" }}
                    title="The new filters can either replace existing filters on the affected channel(s) or be appended at the top/bottom of the existing filters."
                  >
                    <label style={{ display: "flex", alignItems: "center", fontSize: "12px", cursor: "pointer", marginBottom: "0px" }}>
                      <input
                        type="radio"
                        name="filterMergeMode"
                        value="replace"
                        checked={this.state.filterMergeMode === "replace"}
                        onChange={(e) => this.setState({ filterMergeMode: e.target.value }, () => this.generateFilterConfig())}
                        style={{ marginRight: "4px" }}
                      />
                      <span style={{ position: "relative", top: "1px" }}>Replace</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", fontSize: "12px", cursor: "pointer", marginBottom: "0px" }}>
                      <input
                        type="radio"
                        name="filterMergeMode"
                        value="append_top"
                        checked={this.state.filterMergeMode === "append_top"}
                        onChange={(e) => this.setState({ filterMergeMode: e.target.value }, () => this.generateFilterConfig())}
                        style={{ marginRight: "4px" }}
                      />
                      <span style={{ position: "relative", top: "1px" }}>Append (top)</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", fontSize: "12px", cursor: "pointer", marginBottom: "0px" }}>
                      <input
                        type="radio"
                        name="filterMergeMode"
                        value="append_bottom"
                        checked={this.state.filterMergeMode === "append_bottom"}
                        onChange={(e) => this.setState({ filterMergeMode: e.target.value }, () => this.generateFilterConfig())}
                        style={{ marginRight: "4px" }}
                      />
                      <span style={{ position: "relative", top: "1px" }}>Append (bottom)</span>
                    </label>
                  </div>

                  {/* Selection summary */}
                  <div style={{ fontSize: "12px", color: "#666", marginBottom: "10px" }}>
                    Selected: {mergedEntries.filter(e => e.selected).length} entries
                    {(() => {
                      const selected = mergedEntries.filter(e => e.selected);
                      const count11Bit = selected.filter(e => !e.isGroup && e.idInt <= 0x7FF).length;
                      const count29Bit = selected.filter(e => e.isGroup || e.idInt > 0x7FF).length;
                      const sizePercent = selected.reduce((sum, e) => sum + (e.isGroup ? (e.groupedPercentage || 0) : (e.percentage || 0)), 0);
                      return ` (${count11Bit} 11-bit, ${count29Bit} 29-bit) | ${sizePercent.toFixed(1)}%`;
                    })()}
                  </div>

                  {/* Action buttons */}
                  {(() => {
                    const isFirmwareSupported = this.isFirmwareVersionSupported();
                    const isCanmod = this.props.deviceType === "CANmod";
                    const isCanmodRouter = isCanmod && this.isCanmodRouter();
                    const minFirmware = isCanmod ? MIN_FIRMWARE_CANMOD_ROUTER : MIN_FIRMWARE_CANEDGE;
                    
                    // For CANmod, only CANmod.router is supported
                    const isDeviceSupported = !isCanmod || isCanmodRouter;
                    
                    return (
                      <React.Fragment>
                        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                          <button
                            className="btn btn-primary"
                            onClick={this.onMerge}
                            disabled={!this.props.formData || Object.keys(this.props.formData).length === 0 || this.state.mergedConfigValid !== true || !isFirmwareSupported || !isDeviceSupported}
                          >
                            Merge files
                          </button>
                          <button
                            className="btn btn-default"
                            onClick={this.onDownload}
                            disabled={Object.keys(this.state.generatedFilterConfig).length === 0}
                          >
                            Download JSON
                          </button>
                        </div>
                        {this.props.formData && Object.keys(this.props.formData).length > 0 && isDeviceSupported && !isFirmwareSupported && (
                          <div style={{ fontSize: "12px", color: "#666", marginTop: "8px" }}>
                            Merging requires firmware {minFirmware}.XX+ - please update your device
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })()}

                  {/* Preview toggle */}
                  {Object.keys(this.state.generatedFilterConfig).length > 0 && (
                    <div style={{ marginTop: "10px" }}>
                      <label style={{ display: "flex", alignItems: "center", cursor: "pointer", fontSize: "12px" }}>
                        <input
                          type="checkbox"
                          checked={this.state.showFilterPreview}
                          onChange={() => this.setState({ showFilterPreview: !this.state.showFilterPreview })}
                          style={{ marginRight: "6px", marginBottom: "4px" }}
                        />
                        Show partial config preview
                      </label>

                      {this.state.showFilterPreview && (
                        <div style={{ marginTop: "10px" }}>
                          <pre className="browse-file-preview" style={{ maxHeight: "300px", overflow: "auto", fontSize: "11px" }}>
                            {JSON.stringify(this.state.generatedFilterConfig, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* Hidden form for validation */}
        <div style={{ display: "none" }}>
          <Form
            validator={validator}
            onError={this.onValidationError}
            schema={this.props.schemaContent ? this.props.schemaContent : {}}
            formData={this.state.mergedConfig ? this.state.mergedConfig : {}}
            onSubmit={this.onSubmit}
            ref={(form) => { yourForm = form; }}
          />
        </div>

        {/* Spacer */}
        <div><br /><br /><br /><br /><br /><br /></div>
      </div>
    );
  }
}

const mapStateToProps = (state) => {
  return {
    formData: state.editor.formData,
    schemaContent: state.editor.schemaContent,
    editorConfigFiles: state.editor.editorConfigFiles,
    detectedDeviceType: state.editor.detectedDeviceType,
  };
};

const mapDispatchToProps = (dispatch) => {
  return {
    setConfigContent: (content) =>
      dispatch(actionsEditor.setConfigContent(content)),
    setUpdatedFormData: (formData) =>
      dispatch(actionsEditor.setUpdatedFormData(formData)),
  };
};

export default connect(mapStateToProps, mapDispatchToProps)(FilterBuilderTool);
