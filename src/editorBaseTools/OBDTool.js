import React from "react";
import { connect } from "react-redux";
import Files from "react-files";
import * as actionsEditor from "../editorBase/actions";
import Ajv from "ajv";
import SimpleDropdown from "./SimpleDropdown";

// Import PID data, control signal config, and identify supported PIDs config
import obdPids from "../editorBaseTools/obd/obd-pids-service-01.json";
import controlSignalConfig from "../editorBaseTools/obd/control-signal-internal-gps-01.09.json";
import identifySupportedPidsConfig from "../editorBaseTools/obd/identify-supported-pids.json";
import { parseSupportedPids } from "../editorBaseTools/obd/supportedPidsParser";

const merge = require("deepmerge");

// Options for dropdowns
const modeOptions = [
  { value: "all", label: "Select from all PIDs" },
  { value: "supported", label: "Select from supported PIDs" },
  { value: "test", label: "Identify supported PIDs" }
];

const bitRateOptions = [
  { value: "500000", label: "500K" },
  { value: "250000", label: "250K" }
];

const canIdOptions = [
  { value: "7DF", label: "7DF" },
  { value: "18DB33F1", label: "18DB33F1" }
];

const obdModeOptions = [
  { value: "OBD2", label: "OBD2" },
  { value: "WWH-OBD", label: "WWH-OBD" }
];

const channelOptions = [
  { value: "can_1", label: "CAN-1" },
  { value: "can_2", label: "CAN-2" }
];

class OBDTool extends React.Component {
  constructor(props) {
    super(props);

    this.onMerge = this.onMerge.bind(this);
    this.onDownload = this.onDownload.bind(this);
    this.testMergedFile = this.testMergedFile.bind(this);
    this.onSubmit = this.onSubmit.bind(this);
    this.onValidationError = this.onValidationError.bind(this);
    this.handleModeChange = this.handleModeChange.bind(this);
    this.handleSettingChange = this.handleSettingChange.bind(this);
    this.handleSearchChange = this.handleSearchChange.bind(this);
    this.handlePidToggle = this.handlePidToggle.bind(this);
    this.handleMasterToggle = this.handleMasterToggle.bind(this);
    this.handleCsvUpload = this.handleCsvUpload.bind(this);
    this.generateTransmitList = this.generateTransmitList.bind(this);

    // Create unique PID list with index as unique identifier
    const pidsWithIndex = obdPids.map((pid, index) => ({
      ...pid,
      uniqueId: index,
      selected: false
    }));

    this.state = {
      // Tool mode
      toolMode: "all", // "all", "supported", "test"
      
      // Settings
      channel: "can_1",
      bitRate: "500000",
      canId: "7DF",
      obdMode: "OBD2", // "OBD2" or "WWH-OBD"
      spacing: 300,
      
      // PID selection
      pids: pidsWithIndex,
      searchQuery: "",
      supportedPids: [], // PIDs from CSV upload
      
      // Generated config
      generatedConfig: {},
      combinedConfig: {},
      mergedConfig: {},
      mergedConfigValid: "Unknown",
      
      // CSV file
      csvFileName: "",
      mixedWarning: null,
      
      // UI options
      showPreview: false,
      
      // Control signal option
      enableControlSignal: false,
      
      // OBD filter option
      enableOBDFilter: false
    };

    this.fileReader = new FileReader();
    this.fileReader.onload = (event) => {
      this.parseCsvFile(event.target.result);
    };
  }

  handleModeChange(selectedOption) {
    this.setState({ toolMode: selectedOption.value }, () => {
      if (selectedOption.value === "test") {
        this.generateTestConfig();
      }
    });
  }

  handleSettingChange(setting, selectedOption) {
    this.setState({ [setting]: selectedOption.value }, () => {
      if (this.state.toolMode === "test") {
        this.generateTestConfig();
      } else if (this.getSelectedPids().length > 0) {
        this.generateTransmitList();
      }
    });
  }

  generateTestConfig() {
    const { channel, bitRate } = this.state;
    
    // Deep clone the config
    const testConfig = JSON.parse(JSON.stringify(identifySupportedPidsConfig));
    
    // The original config has can_1, we need to rename it if channel is can_2
    if (channel === "can_2") {
      testConfig.can_2 = testConfig.can_1;
      delete testConfig.can_1;
      testConfig.can_2.phy.bit_rate_std = parseInt(bitRate);
    } else {
      testConfig.can_1.phy.bit_rate_std = parseInt(bitRate);
    }
    
    this.setState({ generatedConfig: testConfig }, () => {
      this.testMergedFile();
    });
  }

  handleSearchChange(e) {
    this.setState({ searchQuery: e.target.value });
  }

  handlePidToggle(uniqueId) {
    this.setState(prevState => {
      const pids = prevState.pids.map(pid => 
        pid.uniqueId === uniqueId ? { ...pid, selected: !pid.selected } : pid
      );
      return { pids };
    }, () => {
      this.generateTransmitList();
    });
  }

  handleMasterToggle() {
    const filteredPids = this.getFilteredPids();
    // Only consider non-disabled PIDs for master toggle
    const enabledPids = filteredPids.filter(p => !p.disabled);
    const allSelected = enabledPids.length > 0 && enabledPids.every(pid => pid.selected);
    
    this.setState(prevState => {
      const enabledIds = new Set(enabledPids.map(p => p.uniqueId));
      const pids = prevState.pids.map(pid => 
        enabledIds.has(pid.uniqueId) ? { ...pid, selected: !allSelected } : pid
      );
      return { pids };
    }, () => {
      this.generateTransmitList();
    });
  }

  getFilteredPids() {
    const { pids, searchQuery, toolMode, supportedPids } = this.state;
    
    let filtered = pids;
    
    // In "supported" mode, mark unsupported PIDs as disabled (grayed out)
    if (toolMode === "supported" && supportedPids.length > 0) {
      const supportedSet = new Set(supportedPids);
      filtered = filtered.map(pid => ({
        ...pid,
        disabled: !supportedSet.has(pid.pid),
        // Deselect unsupported PIDs
        selected: supportedSet.has(pid.pid) ? pid.selected : false
      }));
    } else {
      // In other modes, no PIDs are disabled
      filtered = filtered.map(pid => ({
        ...pid,
        disabled: false
      }));
    }
    
    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(pid => 
        pid.description.toLowerCase().includes(query) ||
        pid.name.toLowerCase().includes(query) ||
        pid.pid.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  }

  getSelectedPids() {
    return this.state.pids.filter(pid => pid.selected);
  }

  parseCsvFile(csvContent) {
    try {
      // Parse CSV to extract supported PIDs using the parser
      const result = parseSupportedPids(csvContent);
      
      if (result.supportedPids.length === 0) {
        this.props.showAlert("warning", "No responses related to supported PIDs found in the CSV file");
        return;
      }
      
      // Update state with parsed data
      const stateUpdate = { 
        supportedPids: result.supportedPids 
      };
      
      // Auto-set protocol if detected
      if (result.protocol) {
        stateUpdate.obdMode = result.protocol;
      }
      
      // Auto-set CAN ID based on response type
      if (result.transmitId) {
        stateUpdate.canId = result.transmitId;
      }
      
      // Store mixed info for display
      if (result.hasMixedIds || result.hasMixedProtocols) {
        stateUpdate.mixedWarning = `CSV contains multiple IDs/protocols with supported PIDs. View reflects ID ${result.transmitId} and protocol ${result.protocol || 'Unknown'}`;
      } else {
        stateUpdate.mixedWarning = null;
      }
      
      this.setState(stateUpdate);
      this.props.showAlert(
        "success", 
        `Loaded ${result.totalFrames} frames`
      );
    } catch (e) {
      this.props.showAlert("danger", "Error parsing CSV file: " + e.message);
    }
  }

  handleCsvUpload(file) {
    if (file && file.length > 0) {
      this.setState({ csvFileName: file[0].name });
      this.fileReader.readAsText(file[0]);
    }
  }

  generateTransmitList() {
    const { channel, bitRate, canId, obdMode, spacing } = this.state;
    const selectedPids = this.getSelectedPids();
    
    if (selectedPids.length === 0) {
      this.setState({ generatedConfig: {} });
      return;
    }

    // Calculate period: max offset + spacing
    const maxOffset = (selectedPids.length - 1) * spacing;
    const period = maxOffset + spacing;

    // Determine id_format based on CAN ID
    const idFormat = canId === "7DF" ? 0 : 1; // 0 for 11-bit, 1 for 29-bit
    
    // Generate transmit messages
    const transmitList = selectedPids.map((pid, index) => {
      const delay = index * spacing;
      const data = this.generateDataPayload(pid.pid, obdMode);
      const namePrefix = canId === "7DF" ? "11" : "29";
      const modePrefix = obdMode === "OBD2" ? "OBD" : "OBDU";
      
      return {
        name: `${namePrefix}_${modePrefix}_PID_${pid.pid}`,
        state: 1,
        id_format: idFormat,
        frame_format: 0,
        brs: 0,
        log: 0,
        period: period,
        delay: delay,
        id: canId,
        data: data
      };
    });

    // Build the config structure using selected channel
    const generatedConfig = {
      [channel]: {
        general: {
          rx_state: 1,
          tx_state: 1
        },
        phy: {
          mode: 0,
          retransmission: 1,
          fd_spec: 0,
          bit_rate_cfg_mode: 1,
          bit_rate_std: parseInt(bitRate),
          bit_rate_fd: 1000000
        },
        transmit: transmitList
      }
    };

    this.setState({ generatedConfig }, () => {
      this.testMergedFile();
    });
  }

  generateDataPayload(pidHex, obdMode) {
    // Ensure PID is uppercase and 2 characters
    const pid = pidHex.toUpperCase().padStart(2, '0');
    
    if (obdMode === "OBD2") {
      // OBD2/OBDonEDS format: 02 01 {PID} 55 55 55 55 55
      return `0201${pid}5555555555`;
    } else {
      // WWH-OBD/OBDonUDS format: 03 22 F4 {PID} 55 55 55 55
      return `0322F4${pid}55555555`;
    }
  }

  testMergedFile() {
    const { generatedConfig, enableControlSignal, enableOBDFilter, channel, canId } = this.state;
    const { formData } = this.props;

    if (!formData || Object.keys(generatedConfig).length === 0) {
      return;
    }

    const overwriteMerge = (destinationArray, sourceArray, options) => sourceArray;
    
    // Combine OBD config with control signal config if enabled
    let combinedConfig = generatedConfig;
    if (enableControlSignal) {
      combinedConfig = merge(generatedConfig, controlSignalConfig, {
        arrayMerge: overwriteMerge,
      });
    }
    
    // Add OBD filter config if enabled
    if (enableOBDFilter) {
      const is29Bit = canId !== "7DF";
      let filterConfig;
      
      if (is29Bit) {
        // 29-bit: ID 18DAF115, Mask type with PDU1 mask 3FF0000
        filterConfig = {
          [channel]: {
            filter: {
              id: [{
                name: "OBD_Response",
                state: 1,
                type: 0, // Acceptance
                id_format: 1, // 29-bit
                method: 1, // Mask
                f1: "18DAF115",
                f2: "3FF0000",
                prescaler_type: 0,
                prescaler_value: 0
              }]
            }
          }
        };
      } else {
        // 11-bit: ID 7E8, Range type with f1=f2=7E8
        filterConfig = {
          [channel]: {
            filter: {
              id: [{
                name: "OBD_Response",
                state: 1,
                type: 0, // Acceptance
                id_format: 0, // 11-bit
                method: 0, // Range
                f1: "7E8",
                f2: "7E8",
                prescaler_type: 0,
                prescaler_value: 0
              }]
            }
          }
        };
      }
      
      combinedConfig = merge(combinedConfig, filterConfig, {
        arrayMerge: overwriteMerge,
      });
    }
    
    // Store combinedConfig for preview
    this.setState({ combinedConfig });
    
    let mergedConfigTemp = merge(formData, combinedConfig, {
      arrayMerge: overwriteMerge,
    });

    this.setState({ mergedConfig: mergedConfigTemp }, () => {
      // Validate merged config against schema using AJV directly
      const { schemaContent } = this.props;
      if (schemaContent && mergedConfigTemp) {
        try {
          const ajv = new Ajv({ allErrors: true, strict: false, logger: false });
          const validate = ajv.compile(schemaContent);
          const valid = validate(mergedConfigTemp);
          this.setState({ mergedConfigValid: valid });
        } catch (e) {
          this.setState({ mergedConfigValid: false });
        }
      }
    });
  }

  onSubmit() {
    this.setState({ mergedConfigValid: true });
  }

  onValidationError() {
    this.setState({ mergedConfigValid: false });
  }

  onMerge() {
    const { combinedConfig, mergedConfigValid, enableControlSignal } = this.state;
    const { formData } = this.props;
    
    // Check schema validation first
    if (mergedConfigValid !== true) {
      this.props.showAlert("warning", "Cannot merge - the combined configuration is invalid. Check console for details.");
      return;
    }

    if (!formData || !combinedConfig || Object.keys(combinedConfig).length === 0) {
      this.props.showAlert("warning", "No OBD configuration to merge.");
      return;
    }
    
    // Always regenerate merged config using current formData to ensure we use latest config state
    const overwriteMerge = (destinationArray, sourceArray, options) => sourceArray;
    const freshMergedConfig = merge(formData, combinedConfig, {
      arrayMerge: overwriteMerge,
    });
    
    this.props.setConfigContent(freshMergedConfig);
    this.props.setUpdatedFormData(freshMergedConfig);
    
    // Show warning with success message included, or just success
    if (!enableControlSignal) {
      this.props.showAlert("warning", "Merged OBD transmit list with Configuration File. Important: If your CANedge transmits data while the vehicle ignition is off it can drain the vehicle battery. Use a control signal to start/stop transmission or ensure the device powers off with the ignition (e.g. by changing the installation setup or manually disconnecting the device).");
    } else {
      this.props.showAlert("success", "Merged OBD transmit list with Configuration File");
    }
  }

  onDownload() {
    const { generatedConfig, enableControlSignal } = this.state;
    
    // Warn user if control signal is not enabled
    if (!enableControlSignal) {
      this.props.showAlert("warning", "Important: If your CANedge transmits data while the vehicle ignition is off it can drain the vehicle battery. Use a control signal to start/stop transmission or ensure the device powers off with the ignition (e.g. by changing the installation setup or manually disconnecting the device).");
    }
    
    const dataStr = JSON.stringify(generatedConfig, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    
    const exportFileDefaultName = 'obd-transmit-list.json';
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  }

  render() {
    const { 
      toolMode,
      channel,
      bitRate, 
      canId, 
      obdMode, 
      spacing, 
      searchQuery,
      supportedPids,
      generatedConfig,
      mergedConfig,
      mergedConfigValid,
      csvFileName,
      mixedWarning,
      showPreview,
      enableControlSignal,
      enableOBDFilter,
      combinedConfig
    } = this.state;
    
    const { formData, schemaContent, editorConfigFiles } = this.props;
    
    // Check firmware version from config file name
    const configFileName = editorConfigFiles && editorConfigFiles.length > 0 
      ? editorConfigFiles[0].name 
      : "";
    const isVersion0109 = configFileName.includes("01.09");
    
    // Check if device supports GNSS
    const hasGnssSupport = formData && formData.gnss !== undefined;
    
    const filteredPids = this.getFilteredPids();
    const selectedPids = this.getSelectedPids();
    const enabledFilteredPids = filteredPids.filter(pid => !pid.disabled);
    const allFilteredSelected = enabledFilteredPids.length > 0 && enabledFilteredPids.every(pid => pid.selected);
    
    // Calculate summary values
    const maxOffset = selectedPids.length > 0 ? (selectedPids.length - 1) * spacing : 0;
    const period = maxOffset + spacing;

    // Show version warning if not 01.09
    if (configFileName && !isVersion0109) {
      return (
        <div>
          <h4>OBD tool</h4>
          <p style={{ color: "#666", marginTop: "20px" }}>
            This tool requires firmware 01.09.XX+ - please update your device
          </p>
        </div>
      );
    }

    return (
      <div>
        <h4>OBD tool</h4>

        {/* Mode Selection */}
        <SimpleDropdown
          name="Mode"
          options={modeOptions}
          value={toolMode}
          onChange={this.handleModeChange}
          comment="Select how to choose PIDs for OBD requests"
        />

        {/* CSV Upload for supported PIDs mode */}
        {toolMode === "supported" && (
          <div className="form-group pl0 field-string">
            <p className="reduced-margin" style={{fontSize: "12px", marginBottom: "5px"}}>Load mdf2csv output with your supported PIDs test:</p>
            <div className="text-area-wrapper row no-gutters reduced-margin">
              <div className="file-dropzone">
                <Files
                  onChange={this.handleCsvUpload}
                  onError={(error) => this.props.showAlert("danger", error.message)}
                  accepts={[".csv"]}
                  multiple={false}
                  maxFileSize={10000000}
                  minFileSize={0}
                  clickable
                >
                  <button className="btn btn-primary">Load CSV file</button>
                  <div 
                    className="browse-file-name" 
                    title={csvFileName}
                  >
                    {csvFileName.length > 22 ? csvFileName.substring(0, 22) + "..." : csvFileName}
                  </div>
                </Files>
              </div>
            </div>
            {mixedWarning && (
              <div style={{ color: "orange", fontSize: "12px", marginTop: "8px" }}>
                {mixedWarning}
              </div>
            )}
          </div>
        )}

        {/* Only show subsequent fields if not in 'supported' mode OR if CSV with supported PIDs has been loaded */}
        {(toolMode !== "supported" || supportedPids.length > 0) && (
        <div>
        {/* Row 1: Channel, Bit-rate */}
        <div className="row">
          <div className="col-xs-6">
            <SimpleDropdown
              name="Channel"
              options={channelOptions}
              value={channel}
              onChange={(opt) => this.handleSettingChange("channel", opt)}
              comment="Select which CAN channel should be used to transmit the OBD requests."
            />
          </div>
          <div className="col-xs-6">
            <SimpleDropdown
              name="Bit-rate"
              options={bitRateOptions}
              value={bitRate}
              onChange={(opt) => this.handleSettingChange("bitRate", opt)}
              comment="Cars typically use 500K, trucks/buses may use 250K or 500K."
            />
          </div>
        </div>

        {/* Row 2: CAN ID, Protocol - hidden in test mode */}
        {toolMode !== "test" && (
          <div className="row">
            <div className="col-xs-6">
              <SimpleDropdown
                name="CAN ID"
                options={canIdOptions}
                value={canId}
                onChange={(opt) => this.handleSettingChange("canId", opt)}
                comment="Cars typically use 7DF, trucks/buses typically use 18DB33F1."
              />
            </div>
            <div className="col-xs-6">
              <SimpleDropdown
                name="Protocol"
                options={obdModeOptions}
                value={obdMode}
                onChange={(opt) => this.handleSettingChange("obdMode", opt)}
                comment="Cars use OBD2, trucks/buses may use OBD2 or WWH-OBD."
              />
            </div>
          </div>
        )}

        {/* Spacing - hidden in test mode */}
        {toolMode !== "test" && (
          <div className="form-group pl0 field-string">
            Spacing (ms)
            <input 
              type="number" 
              className="form-control encryption-input"
              value={spacing}
              min={100}
              max={10000}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 0;
                this.setState({ spacing: val });
              }}
              onBlur={(e) => {
                const val = Math.min(10000, Math.max(100, parseInt(e.target.value) || 100));
                this.setState({ spacing: val }, () => {
                  if (this.getSelectedPids().length > 0) {
                    this.generateTransmitList();
                  }
                });
              }}
            />
            <span className="field-description field-description-shift">
              Time between each PID request (100-10000 ms). Highly frequent requests (below 500 ms spacing) may result in response errors.
            </span>
            {spacing < 250 && (
              <span style={{ color: "orange", fontSize: "12px", display: "block", marginTop: "4px" }}>
                Recommended spacing is 250+ ms
              </span>
            )}
          </div>
        )}

        {/* PID Selection - hidden in test mode */}
        {toolMode !== "test" && (
          <div className="form-group pl0 field-string">
            PIDs to record
            <span className="field-description field-description-shift">
              Select PIDs to request from the vehicle. Adding more PIDs will result in a longer cycle time (period) between each observation of a single PID.
            </span>
            <div style={{ display: "flex", alignItems: "center", marginBottom: "10px" }}>
              <label className="checkbox-design" style={{ marginLeft: "4px" }}>
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
                placeholder="Search PIDs ..."
                value={searchQuery}
                onChange={this.handleSearchChange}
                style={{ marginLeft: "10px" }}
              />
            </div>
            
            <div className="browse-file-preview" style={{ maxHeight: "140px" }}>
              {filteredPids.map((pid) => (
                <div 
                  key={pid.uniqueId} 
                  className="checkbox-white-space"
                  onClick={() => !pid.disabled && this.handlePidToggle(pid.uniqueId)}
                  style={{ 
                    display: "flex", 
                    alignItems: "center", 
                    padding: "0px 5px",
                    borderBottom: "1px solid #eee",
                    opacity: pid.disabled ? 0.4 : 1,
                    cursor: pid.disabled ? "not-allowed" : "pointer",
                    backgroundColor: pid.selected ? "#e8f4fc" : "#fff"
                  }}
                >
                  <span style={{ width: "24px", flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    <label className="checkbox-design">
                      <input
                        type="checkbox"
                        checked={pid.selected}
                        disabled={pid.disabled}
                        onChange={() => !pid.disabled && this.handlePidToggle(pid.uniqueId)}
                      />
                      <span></span>
                    </label>
                  </span>
                  <span 
                    className="binary-text-alt-2" 
                    style={{ 
                      marginRight: "8px", 
                      minWidth: "24px", 
                      flexShrink: 0 
                    }}
                  >
                    {pid.pid}
                  </span>
                  <span 
                    style={{ 
                      fontSize: "12px", 
                      whiteSpace: "nowrap", 
                      overflow: "hidden", 
                      textOverflow: "ellipsis" 
                    }}
                    title={pid.description}
                  >
                    {pid.description}
                  </span>
                </div>
              ))}
              {filteredPids.length === 0 && (
                <div style={{ padding: "10px", textAlign: "center", color: "#999" }}>
                  No PIDs found
                </div>
              )}
            </div>
          </div>
        )}

        {/* Summary - hidden in test mode */}
        {toolMode !== "test" && (
          <div style={{ fontSize: "12px", marginBottom: "10px" }}>
            Period: {selectedPids.length > 0 ? period : 0} ms &nbsp;|&nbsp; PIDs selected: {selectedPids.length}
          </div>
        )}

        {/* OBD filter option - hidden in test mode */}
        {toolMode !== "test" && (
          <div className="form-group pl0 field-string">
            <label 
              style={{ 
                display: "flex", 
                alignItems: "center", 
                cursor: "pointer",
                fontSize: "12px",
                marginTop: "8px"
              }}
            >
              <input
                type="checkbox"
                checked={enableOBDFilter}
                onChange={() => {
                  this.setState({ enableOBDFilter: !enableOBDFilter }, () => {
                    if (this.getSelectedPids().length > 0) {
                      this.generateTransmitList();
                    }
                  });
                }}
                style={{ marginRight: "6px", marginBottom: "4px" }}
              />
              Add filter to only log OBD data on {channel === "can_1" ? "CAN-1" : "CAN-2"}
            </label>
            <p className="field-description field-description-shift">
              Add a filter to only log OBD response data on the selected CAN channel. This replaces any existing filters on the channel. For 11-bit: Range filter for ID 7E8. For 29-bit: Mask filter for ID 18DAF115 with PDU1 PGN mask.
            </p>
          </div>
        )}

        {/* Control transmission/logging - hidden in test mode */}
        {toolMode !== "test" && (
          <div className="form-group pl0 field-string">
            <label 
              style={{ 
                display: "flex", 
                alignItems: "center", 
                cursor: hasGnssSupport ? "pointer" : "not-allowed",
                fontSize: "12px",
                marginTop: "8px",
                opacity: hasGnssSupport ? 1 : 0.5
              }}
            >
              <input
                type="checkbox"
                checked={enableControlSignal}
                onChange={() => {
                  this.setState({ enableControlSignal: !enableControlSignal }, () => {
                    if (this.getSelectedPids().length > 0) {
                      this.generateTransmitList();
                    }
                  });
                }}
                disabled={!hasGnssSupport}
                style={{ marginRight: "6px", marginBottom: "4px" }}
              />
              Add GPS-based speed control signal
            </label>
            <p className="field-description field-description-shift">
              If the device is powered continuously (even when the vehicle ignition is off), transmitting requests may drain the vehicle battery quickly. To avoid this you can add a control signal that starts/stops logging on all CAN channels and starts/stops transmission on CAN1/CAN2 depending on whether the vehicle speed is above a certain threshold. Requires a CANedge incl. internal GPS/IMU.
            </p>
          </div>
        )}

        {/* Test mode warning */}
        {toolMode === "test" && (
          <div style={{ color: "orange", fontSize: "12px", marginBottom: "15px", marginTop: "10px" }}>
            When testing supported PIDs, make sure the ignition is on for 2 minutes before you connect the device. Let the device be connected for 5 minutes to perform the test.
          </div>
        )}

        {/* Validation error */}
        {mergedConfigValid === false && (
          <p className="red-text">
            <i className="fa fa-times" /> Merged Configuration File is invalid
          </p>
        )}

        {/* Action Buttons */}
        <div>
          <div>
            <button 
              className="btn btn-primary"
              onClick={this.onMerge}
              disabled={!formData || Object.keys(formData).length === 0 || mergedConfigValid !== true}
            >
              Merge files
            </button>
            <button 
              className="btn btn-default"
              onClick={this.onDownload}
              disabled={Object.keys(generatedConfig).length === 0}
              style={{ marginLeft: "10px" }}
            >
              Download JSON
            </button>
          </div>
        </div>

        {/* Preview Toggle */}
        {Object.keys(generatedConfig).length > 0 && (
          <div>
            <label style={{ display: "flex", alignItems: "center", cursor: "pointer", fontSize: "12px", marginTop: "8px"}}>
              <input
                type="checkbox"
                checked={showPreview}
                onChange={() => this.setState({ showPreview: !showPreview })}
                style={{ marginRight: "6px" ,marginBottom: "4px" }}
              />
              Show partial config preview
            </label>
            
            {showPreview && (
              <div style={{ marginTop: "10px" }}>
                <pre className="browse-file-preview">
                  {JSON.stringify(combinedConfig, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
        </div>
        )}

        {/* Spacer - always visible */}
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

export default connect(mapStateToProps, mapDispatchToProps)(OBDTool);
