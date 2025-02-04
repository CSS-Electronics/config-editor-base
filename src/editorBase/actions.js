import saveAs from "file-saver";

export const SET_SCHEMA_LIST = "editor/SET_SCHEMA_LIST";
export const SET_CONFIG_LIST = "editor/SET_CONFIG_LIST";
export const SET_UISCHEMA_LIST = "editor/SET_UISCHEMA_LIST";
export const RESET_SCHEMA_LIST = "editor/RESET_SCHEMA_LIST";
export const RESET_UISCHEMA_LIST = "editor/RESET_UISCHEMA_LIST";
export const RESET_CONFIG_LIST = "editor/RESET_CONFIG_LIST";
export const RESET_LOCAL_UISCHEMA_LIST = "editor/RESET_LOCAL_UISCHEMA_LIST";
export const RESET_LOCAL_SCHEMA_LIST = "editor/RESET_LOCAL_SCHEMA_LIST";
export const RESET_LOCAL_CONFIG_LIST = "editor/RESET_LOCAL_CONFIG_LIST";
export const SET_CONFIG_DATA = "editor/SET_CONFIG_DATA";
export const SET_UI_SCHEMA_DATA = "editor/SET_UI_SCHEMA_DATA";
export const SET_SCHEMA_DATA = "editor/SET_SCHEMA_DATA";
export const SET_UPDATED_CONFIG = "editor/SET_UPDATED_CONFIG";
export const RESET_SCHEMA_FILES = "editor/RESET_SCHEMA_FILES";
export const SET_CONFIG_DATA_PRE_CHANGE = "editor/SET_CONFIG_DATA_PRE_CHANGE";
export const SET_UPDATED_FORM_DATA = "editor/SET_UPDATED_FORM_DATA";
export const SET_ACTIVE_NAV = "editor/SET_ACTIVE_NAV";
export const SET_UISCHEMA_SOURCE = "editor/SET_UISCHEMA_SOURCE";
export const SET_CONFIG_DATA_LOCAL = "SET_CONFIG_DATA_LOCAL";
export const SET_CRC32_EDITOR_LIVE = "SET_CRC32_EDITOR_LIVE";

import * as alertActions from "../alert/actions";


import {
  regexUISchemaPublic,
  regexSchemaPublic,
  isValidUISchema,
  isValidSchema,
  isValidConfig,
  loadFile,
  demoConfig,
  crcBrowserSupport,
  getFileType,
} from "./utils";

// -------------------------------------------------------
// CRC32: Calculate checksums for comparison review of config files
export const calcCrc32EditorLive = () => {
  return function (dispatch, getState) {
    let formData = getState().editor.formData;

    if (crcBrowserSupport == 1 && formData) {
      const { crc32 } = require("crc");
      let crc32EditorLive = crc32(JSON.stringify(formData, null, 2))
        .toString(16)
        .toUpperCase()
        .padStart(8, "0");

      dispatch(setCrc32EditorLive(crc32EditorLive));
    } else {
      let crc32EditorLive = `N/A`;
      dispatch(setCrc32EditorLive(crc32EditorLive));
    }
  };
};

export const setCrc32EditorLive = (crc32EditorLive) => ({
  type: SET_CRC32_EDITOR_LIVE,
  crc32EditorLive,
});

// -------------------------------------------------------
// UISCHEMA: load the Simple/Advanced default UIschema in the online & offline editor
export const publicUiSchemaFiles = (uiSchemaAry, schemaAry, demoMode) => {

  return function (dispatch) {
    if (uiSchemaAry && uiSchemaAry.length) {
      dispatch(resetUISchemaList());
      dispatch(setUISchemaFile(uiSchemaAry));
      dispatch(setUISchemaContent(loadFile(uiSchemaAry[0])));
    }
    // If demoMode, load the Rule Schema by default for use in the online simple editor
    if (demoMode && schemaAry.length) {
      dispatch(publicSchemaFiles(demoConfig, schemaAry, {}, uiSchemaAry));
    }
  };
};

// fetch file content from embedded files
export const fetchFileContent = (fileName, type) => {
  return function (dispatch, getState) {

    // Remove existing "uploaded" files from dropdown and set Schema to loaded file from schema/ folder
    // Note that for cases where files are uploaded, the below is handled as part of the upload function
    switch (true) {
      case type == "uischema":
        dispatch(setConfigContentPreSubmit());
        dispatch(resetLocalUISchemaList());

        if (fileName.match(regexUISchemaPublic) != null) {
          dispatch(setUISchemaContent(loadFile(fileName)));
        } else {
          dispatch(setUISchemaContent(null));
        }

        break;
      case type == "schema":
        dispatch(resetLocalSchemaList());
        if (fileName.match(regexSchemaPublic) != null) {
          dispatch(setSchemaContent(loadFile(fileName)));
        } else {
          dispatch(setSchemaContent(null));
        }

        break;
      case type == "config":
        dispatch(resetLocalConfigList());

        if (fileName == "None") {
          dispatch(setConfigContent(null));
          dispatch(setUpdatedFormData(null));
          dispatch(setConfigContentPreChange(""));
        }

        break;
      case type == "config-review":
        // reload the original local config file for review purposes
        dispatch(
          setConfigContentPreChange(getState().editor.configContentLocal)
        );
        if (fileName == "None") {
          dispatch(setConfigContentPreChange(""));
        }
        break;
    }
  };
};

// handle files uploaded via the Schema Loader dropdowns
export const handleUploadedFile = (file, dropdown, schemaAry, uiSchemaAry) => {
  let type = getFileType(dropdown);

  return function (dispatch, getState) {
    let fileReader = new FileReader();
    fileReader.onloadend = (e) => {
      const content = fileReader.result;
      let contentJSON = null;
      let fileNameDisplay = `${file.name} (local)`;
      try {
        contentJSON = JSON.parse(content);
      } catch (error) {
        window.alert(`Warning: ${file.name} is invalid and was not loaded`);
      }

      if (contentJSON != null) {
        switch (true) {
          case type == "uischema" && isValidUISchema(file.name):
            console.log("contentJSON", contentJSON)
            console.log("fileNameDisplay", fileNameDisplay)
            dispatch(setUISchemaContent(contentJSON));
            dispatch(resetLocalUISchemaList());
            dispatch(setUISchemaFile([fileNameDisplay]));

            break;
          case type == "schema" && isValidSchema(file.name):
            dispatch(setSchemaContent(contentJSON));
            dispatch(resetLocalSchemaList());
            dispatch(setSchemaFile([fileNameDisplay]));
            break;
          case type == "config" && isValidConfig(file.name):
            // load the matching schema files if a schema file is not already uploaded

            const localSchema = getState().editor.editorSchemaFiles[0] && getState().editor.editorSchemaFiles[0].name.includes("(local)") ? true : false;

            if (file && file.name && file.name.length && localSchema == false && schemaAry && schemaAry.length) {
              dispatch(publicSchemaFiles(file.name, schemaAry, contentJSON, uiSchemaAry));
            }


            // add warning regarding OTA update overwrites
            let configIncludesServerDetails = JSON.stringify(contentJSON, null, 2).includes("http://") || JSON.stringify(contentJSON, null, 2).includes("https://")
            if (configIncludesServerDetails) {
              dispatch(
                alertActions.set({
                  type: "warning",
                  message: "If your device is already connected to your server, changes made via the SD will be overwritten by the server Configuration File",
                  autoClear: false,
                })
              );
            }

            // TBD: Look intro trimming below
            dispatch(setConfigContentLocal(content));
            dispatch(setConfigContent(contentJSON));
            dispatch(resetLocalConfigList());
            dispatch(setConfigFile([fileNameDisplay]));
            dispatch(setUpdatedFormData(contentJSON));
            dispatch(setConfigContentPreChange(content));

            break;
          default:
            window.alert(`${file.name} is an invalid file/filename`);
            break;
        }
      }
    };
    fileReader.readAsText(file);
  };
};

// -------------------------------------------------------


export const resetUISchemaList = () => ({
  type: RESET_UISCHEMA_LIST,
  UISchemaFiles: [],
});

export const setUISchemaContent = (uiContent) => ({
  type: SET_UI_SCHEMA_DATA,
  uiContent,
});

export const resetLocalUISchemaList = () => ({
  type: RESET_LOCAL_UISCHEMA_LIST,
});

export const setUISchemaFile = (UISchemaFiles) => ({
  type: SET_UISCHEMA_LIST,
  UISchemaFiles: UISchemaFiles.map((file, index) => ({
    name: file,
    selected: index == 0 ? true : false,
  })),
});

// -------------------------------------------------------
// RULE SCHEMA: load the relevant Rule Schema file when a user uploads a config file (based on revision)
export const publicSchemaFiles = (selectedConfig, schemaAry, contentJSON, uiSchemaAry) => {

  return function (dispatch) {
    dispatch(resetSchemaFiles());

    if (selectedConfig) {
      // test if config is from a CANedge1 to enable further filtering of Rule Schemas
      let deviceType = "Other"

      if (contentJSON.can_2 != undefined && contentJSON.connect == undefined && contentJSON.gnss == undefined) {
        deviceType = "CANedge1"
      }

      if (contentJSON.can_2 != undefined && contentJSON.connect == undefined && contentJSON.gnss != undefined) {
        deviceType = "CANedge1 GNSS"
      }

      if (contentJSON.can_2 != undefined && contentJSON.connect && contentJSON.connect.wifi != undefined && contentJSON.gnss == undefined) {
        deviceType = "CANedge2"
      }

      if (contentJSON.can_2 != undefined && contentJSON.connect && contentJSON.connect.wifi != undefined && contentJSON.gnss != undefined) {
        deviceType = "CANedge2 GNSS"
      }

      if (contentJSON.can_2 != undefined && contentJSON.connect && contentJSON.connect.cellular != undefined && contentJSON.gnss == undefined) {
        deviceType = "CANedge3"
      }

      if (contentJSON.can_2 != undefined && contentJSON.connect && contentJSON.connect.cellular != undefined && contentJSON.gnss != undefined) {
        deviceType = "CANedge3 GNSS"
      }

      // filter schema list based on FW major/minor version
      let schemaAryFiltered = schemaAry.filter((e) =>
      (e.includes(selectedConfig.substr(7, 5))
      ))

      // filter uischema list based on FW major/minor version
      let uiSchemaAryFiltered = uiSchemaAry.filter((e) =>
      (e.includes(selectedConfig.substr(7, 5))
      ))

      // filter schema list to exclude GNSS variants if no GNSS deviceType is selected
      if (!deviceType.includes("GNSS")) {
        schemaAryFiltered = schemaAryFiltered.filter((e) =>
          !e.includes("GNSS")
        );
      }

      // filter schema list based on CANedge1 vs CANedge2 vs. CANedge3 type
      if (deviceType.includes("CANedge")) {
        schemaAryFiltered = schemaAryFiltered.filter((e) =>
          e.includes(deviceType)
        );
      }


      //if (demoMode) {
      //  schemaAryFiltered = schemaAry.filter((e) => e.includes("CANedge2"));
      //}

      const loadedSchema = loadFile(schemaAryFiltered[0])

      if (schemaAryFiltered[0] && loadedSchema) {
        dispatch(setSchemaFile(schemaAryFiltered));
        dispatch(setSchemaContent(loadedSchema));
      } else {
        console.log("Unable to load embedded Rule Schema")
      }

      // load uiSchemaFiltered
      if (uiSchemaAryFiltered && uiSchemaAryFiltered.length) {
        console.log("uiSchemaAryFiltered", uiSchemaAryFiltered)
        dispatch(resetUISchemaList());
        dispatch(setUISchemaFile(uiSchemaAryFiltered));
        dispatch(setUISchemaContent(loadFile(uiSchemaAryFiltered[0])));
      }
    }
  };
};

export const setSchemaFile = (schemaFiles) => ({
  type: SET_SCHEMA_LIST,
  schemaFiles: schemaFiles.map((file, index) => ({
    name: file,
    selected: index == 0 ? true : false,
  })),
});


export const resetSchemaFiles = () => ({
  type: RESET_SCHEMA_LIST,
  schemaFiles: [],
});

export const setSchemaContent = (schemaContent) => ({
  type: SET_SCHEMA_DATA,
  schemaContent,
});

export const resetFiles = () => ({
  type: RESET_SCHEMA_FILES,
  reset: true,
});

export const resetLocalSchemaList = () => ({
  type: RESET_LOCAL_SCHEMA_LIST,
});


// function for testing for invalid transmit list entries
export const checkConfigTransmitPeriodDelay = (content) => {
  return function (dispatch) {
    for (let i = 1; i < 3; i++) {
      if (content["can_" + i].transmit != undefined) {
        let transmitListFiltered = content["can_" + i].transmit.filter((e) =>
          e.period > 0 && (e.period <= e.delay)
        );
        if (transmitListFiltered.length > 0) {
          dispatch(
            alertActions.set({
              type: "warning",
              message: "Your CAN CH" + i + " transmit list includes one or more entries with period <= delay. This is invalid and will cause the device to reject your Configuration File",
              autoClear: false,
            })
          );
        }
      }
    }
  }
}


// function for testing for silent mode plus transmit lists
export const checkConfigTransmitMonitoring = (content) => {

  return function (dispatch) {
    for (let i = 1; i < 3; i++) {
      if (content["can_" + i].transmit != undefined && content["can_" + i].phy != undefined && content["can_" + i].phy.mode != undefined && content["can_" + i].transmit.length > 0) {
        if (content["can_" + i].phy.mode != 0) {
          dispatch(
            alertActions.set({
              type: "warning",
              message: "Your CAN CH" + i + " has a non-empty transmit list, but the device will not transmit any messages unless the mode is set to Normal",
              autoClear: false,
            })
          );
        }
      }
    }
  }
}

// function for testing if all filters are disabled
export const checkConfigFiltersDisabled = (content) => {

  return function (dispatch) {
    for (let i = 1; i < 3; i++) {
      if (content["can_" + i].filter != undefined && content["can_" + i].filter.id != undefined) {
        let filterListFiltered = content["can_" + i].filter.id.filter((e) =>
          e.state == 1
        );
        if (filterListFiltered.length == 0) {
          dispatch(
            alertActions.set({
              type: "warning",
              message: "Your CAN CH" + i + " filter list contains only disabled filters - no data will be recorded on this channel",
              autoClear: false,
            })
          );
        }
      }
    }
  }
}


// function for testing if control signal scaling factor is 0 despite being enabled
export const checkConfigControlSignalZeroScalingFactor = (content) => {
  return function (dispatch) {
    let channels = ["can_1", "can_2", "can_internal"]
    let channel_names = ["CAN CH1", "CAN CH2", "CAN INTERNAL"]

    for (let i = 0; i < 3; i++) {
      if (content[channels[i]] != undefined && content[channels[i]].control != undefined) {
        let can_control = content[channels[i]].control
        if (can_control.control_rx_state != undefined && can_control.control_tx_state != undefined) {
          if (can_control.control_rx_state != 0 || can_control.control_tx_state != 0) {
            let type_list = ["start", "stop"]
            for (let j = 0; j < 2; j++) {
              let type = type_list[j]

              if (can_control[type] != undefined && can_control[type].signal != undefined && can_control[type].signal.factor != undefined && can_control[type].signal.length != undefined) {
                let fields = ["factor", "length"]
                let field_names = ["signal scaling factor", "signal bit length"]
                for (let k = 0; k < 2; k++) {
                  if (can_control[type].signal[fields[k]] == 0) {
                    dispatch(
                      alertActions.set({
                        type: "warning",
                        message: "You have enabled a Control Signal on " + channel_names[i] + " (" + type + ") with a " + field_names[k] + " of 0 - this will result in a constant signal value and is most likely not intended.",
                        autoClear: false,
                      })
                    );
                  }
                }

              }
            }

          }

        }
      }

    }

  }
}


// function for testing if S3 settings contains https:// and port 80
export const checkConfigTls = (content) => {

  return function (dispatch) {
    if (content.connect != undefined && content.connect.s3 != undefined && content.connect.s3.server != undefined) {

      if (content.connect.s3.server.endpoint != undefined && content.connect.s3.server.port != undefined) {
        if (content.connect.s3.server.endpoint.includes("https://") && content.connect.s3.server.port == 80) {
          dispatch(
            alertActions.set({
              type: "warning",
              message: "Your S3 server endpoint uses TLS (https://), but your port is 80. This is most likely incorrect and may result in the device being unable to connect. Please review the documentation on how to enable TLS",
              autoClear: false,
            })
          );
        }

      }
    }
  }
}

// function for testing if S3 settings contain an invalid AWS endpoint syntax
export const checkConfigAwsEndpoint = (content) => {

  const regexAwsS3Endpoint = new RegExp("^https?:\\/\\/s3\\.[a-z]{2}-[a-z]+-\\d{1}\\.amazonaws\\.com$", "g");

  return function (dispatch) {
    if (content.connect != undefined && content.connect.s3 != undefined && content.connect.s3.server != undefined) {

      if (content.connect.s3.server.endpoint != undefined) {
        let endpoint = content.connect.s3.server.endpoint
        if (endpoint.includes("amazonaws") && !regexAwsS3Endpoint.test(endpoint)) {
          dispatch(
            alertActions.set({
              type: "warning",
              message: "Your S3 endpoint seems to be for AWS, but with incorrect syntax. Please review the documentation on how to configure the device for AWS S3 endpoints",
              autoClear: false,
            })
          );
        }

      }
    }
  }
}

// function for testing if S3 password is set as encrypted without kpub
export const checkS3EncryptedPasswordsNoKpub = (content) => {

  return function (dispatch) {
    if (content.connect != undefined && content.connect.s3 != undefined && content.connect.s3.server != undefined && content.general != undefined && content.general.security != undefined) {

      if (content.connect.s3.server.secretkey != undefined && content.connect.s3.server.keyformat != undefined) {
        if (content.connect.s3.server.keyformat == 1 && (content.general.security.kpub == undefined || content.general.security.kpub == "")) {
          dispatch(
            alertActions.set({
              type: "warning",
              message: "Your S3 SecretKey format is set to Encrypted, but you have not provided the Server public key. Please review the documentation on how to encrypt passwords",
              autoClear: false,
            })
          );
        }

      }
    }
  }
}


// function for testing if S3 password is set as encrypted without kpub
export const checkWiFiEncryptedPasswordsNoKpub = (content) => {

  return function (dispatch) {
    if (content.connect != undefined && content.connect.wifi != undefined && content.connect.wifi.keyformat != undefined && content.general != undefined && content.general.security != undefined) {

      if (content.connect.wifi.keyformat != undefined) {
        if (content.connect.wifi.keyformat == 1 && (content.general.security.kpub == undefined || content.general.security.kpub == "")) {
          dispatch(
            alertActions.set({
              type: "warning",
              message: "Your WiFi Key format is set to Encrypted, but you have not provided the Server public key. Please review the documentation on how to encrypt passwords",
              autoClear: false,
            })
          );
        }

      }
    }
  }
}


// function for testing if File split time offset is larger than period
export const checkFileSplitOffsetPeriod = (content) => {

  return function (dispatch) {
    if (content.log != undefined && content.log.file != undefined && content.log.file.split_time_period != undefined && content.log.file.split_time_offset != undefined) {

      if (content.log.file.split_time_offset > content.log.file.split_time_period) {
        dispatch(
          alertActions.set({
            type: "warning",
            message: "Your log file split time offset is set larger than your file split time period. This is invalid and will cause the device to reject the Configuration File",
            autoClear: false,
          })
        );
      }

    }
  }
}

// function for testing if RTC Adjustment field exceeds expected value (for CANedge2/CANedge3)
export const checkRTCAdjustment = (content) => {

  return function (dispatch) {
    if (content.connect != undefined && content.rtc != undefined && content.rtc.adjustment != undefined && content.rtc.adjustment > 400) {

      dispatch(
        alertActions.set({
          type: "warning",
          message: "Your RTC Adjustment value exceeds 400 seconds (this field is intended for small drift corrections, not e.g. time zone adjustments). Large values may cause issues with S3 connectivity",
          autoClear: false,
        })
      );


    }
  }
}



// function for testing if S3 settings contains http:// and port 443
export const checkConfigTlsPort = (content) => {

  return function (dispatch) {
    if (content.connect != undefined && content.connect.s3 != undefined && content.connect.s3.server != undefined) {

      if (content.connect.s3.server.endpoint != undefined && content.connect.s3.server.port != undefined) {
        if (content.connect.s3.server.endpoint.includes("http://") && content.connect.s3.server.port == 443) {
          dispatch(
            alertActions.set({
              type: "warning",
              message: "Your S3 server endpoint does not use TLS (http://), but your port is 443. This is most likely incorrect and may result in the device being unable to connect. Please review the documentation on how to enable TLS",
              autoClear: false,
            })
          );
        }

      }
    }
  }
}


// function for testing if missing APN details
export const checkMissingAPN = (content) => {

  return function (dispatch) {
    if (content.connect != undefined && content.connect.s3 != undefined && content.connect.s3.server != undefined && content.connect.cellular != undefined && content.connect.cellular.apn != undefined) {

      console.log("content.connect.cellular.apn", content.connect.cellular.apn)
      if (content.connect.s3.server.endpoint != undefined && content.connect.cellular.apn != undefined) {
        if (content.connect.s3.server.endpoint.includes("http") && content.connect.cellular.apn == "") {
          dispatch(
            alertActions.set({
              type: "warning",
              message: "Your SIM APN is blank. This is most likely incorrect and may result in the device being unable to connect. Please add the APN if it exists",
              autoClear: false,
            })
          );
        }

      }
    }
  }
}

// function for testing if Telekom APN is incorrect
export const checkIncorrectAPNTelekom = (content) => {

  return function (dispatch) {
    if (content.connect != undefined && content.connect.s3 != undefined && content.connect.s3.server != undefined && content.connect.cellular != undefined && content.connect.cellular.apn != undefined) {

      if (content.connect.s3.server.endpoint != undefined && content.connect.cellular.apn != undefined) {
        if (content.connect.s3.server.endpoint.includes("http") && content.connect.cellular.apn == "internet.v6.telekom") {
          dispatch(
            alertActions.set({
              type: "warning",
              message: "Your SIM APN is set to 'internet.v6.telekom', which is not compatible with the device - please set it to 'internet.telekom' instead",
              autoClear: false,
            })
          );
        }

      }
    }
  }
}

// function for testing if Super SIM APN is incorrect
export const checkIncorrectAPNSuperSIM = (content) => {

  return function (dispatch) {
    if (content.connect != undefined && content.connect.s3 != undefined && content.connect.s3.server != undefined && content.connect.cellular != undefined && content.connect.cellular.apn != undefined && content.connect.s3.server.region != undefined) {

        if (content.connect.s3.server.region.includes("eu") && content.connect.cellular.apn == "super") {
          dispatch(
            alertActions.set({
              type: "warning",
              message: "Your Super SIM APN is set to 'super', but your S3 region appears to be in EU - please set your APN to 'de1.super' for optimal speed",
              autoClear: false,
            })
          );
        }

      
    }
  }
}


// function for testing if Super SIM roaming is enabled
export const checkIncorrectRoamingSuperSIM = (content) => {

  return function (dispatch) {
    if (content.connect != undefined && content.connect.s3 != undefined && content.connect.s3.server != undefined && content.connect.cellular != undefined && content.connect.cellular.apn != undefined && content.connect.cellular.roaming != undefined && content.connect.s3.server.endpoint != undefined) {

        if (content.connect.s3.server.endpoint.includes("http") && content.connect.cellular.roaming == 0 && (content.connect.cellular.apn == "super" || content.connect.cellular.apn == "de1.super" || content.connect.cellular.apn == "sg.super")) {
          dispatch(
            alertActions.set({
              type: "warning",
              message: "Roaming must be enabled when using a Super SIM",
              autoClear: false,
            })
          );
        }      
    }
  }
}

// function for testing if APN includes spaces incorrect
export const checkIncorrectAPNSpaces = (content) => {

  return function (dispatch) {
    if (content.connect != undefined && content.connect.s3 != undefined && content.connect.s3.server != undefined && content.connect.cellular != undefined && content.connect.cellular.apn != undefined && content.connect.s3.server.endpoint != undefined) {

        if (content.connect.s3.server.endpoint.includes("http") && (content.connect.cellular.apn.startsWith(" ") || content.connect.cellular.apn.endsWith(" "))) {
          dispatch(
            alertActions.set({
              type: "warning",
              message: "Your APN starts/ends with spaces - please review, as this is most likely not correct",
              autoClear: false,
            })
          );
        }
    
    }
  }
}





// function for warning if 10S to 50S splits are used
export const checkFileSplitValue = (content) => {

  return function (dispatch) {
    if (content.log != undefined && content.log.file != undefined && content.log.file.split_time_period != undefined) {

      if (content.log.file.split_time_period < 60 && content.log.file.split_time_period > 0) {
        dispatch(
          alertActions.set({
            type: "warning",
            message: "Your log files are currently set to split every " + content.log.file.split_time_period + " seconds. This increases the storage used (due to overhead) and reduces data transfer/processing performance. Consider increasing your split time",
            autoClear: false,
          })
        );
      }

    }
  }
}



// function for warning about GNSS Estimate
export const checkGNSSEstimate = (content) => {

  return function (dispatch) {
    if (content.gnss != undefined && content.gnss.alignment != undefined && content.gnss.alignment.method != undefined) {

      if (content.gnss.alignment.method == 1) {
        dispatch(
          alertActions.set({
            type: "warning",
            message: "Your GNSS IMU-mount alignment is set to 'Estimate' - note that the device will not record any GPS/IMU data in this mode",
            autoClear: false,
          })
        );
      }


    }
  }
}

// -------------------------------------------------------
// CONFIGURATION FILE:
export const saveUpdatedConfiguration = (filename, content) => {
  return function (dispatch) {

    // if CANedge, warn if invalid/problematic content in Configuration File
    if (content.can_2 != undefined) {
      dispatch(checkConfigTransmitPeriodDelay(content))
      dispatch(checkConfigTransmitMonitoring(content))
      dispatch(checkConfigFiltersDisabled(content))
      dispatch(checkConfigTls(content))
      dispatch(checkConfigAwsEndpoint(content))
      dispatch(checkS3EncryptedPasswordsNoKpub(content))
      dispatch(checkWiFiEncryptedPasswordsNoKpub(content))
      dispatch(checkFileSplitOffsetPeriod(content))
      dispatch(checkRTCAdjustment(content))
      dispatch(checkConfigTlsPort(content))
      dispatch(checkFileSplitValue(content))
      dispatch(checkMissingAPN(content))
      dispatch(checkIncorrectAPNSuperSIM(content))
      dispatch(checkIncorrectAPNTelekom(content))
      dispatch(checkIncorrectAPNSpaces(content))
      dispatch(checkGNSSEstimate(content))
      dispatch(checkIncorrectRoamingSuperSIM(content))
      dispatch(checkConfigControlSignalZeroScalingFactor(content))
    }

    dispatch(setConfigContent(content));
    let blob = new Blob([JSON.stringify(content, null, 2)], {
      type: "text/json",
    });
    saveAs(blob, `${filename}`);
  };
};

export const setUpdatedFormData = (formData) => {
  return function (dispatch) {
    dispatch(setUpdatedFormDataValue(formData));
    dispatch(calcCrc32EditorLive());
  };
};

export const setUpdatedFormDataValue = (formData) => ({
  type: SET_UPDATED_FORM_DATA,
  formData,
});


export const setConfigFile = (configFiles) => ({
  type: SET_CONFIG_LIST,
  configFiles: configFiles.map((file, index) => ({
    name: file,
    selected: index == 0 ? true : false,
  })),
});

// this ensures that if the rjsf Form is reloaded (e.g. due to state change), it uses the latest formData
export const setConfigContentPreSubmit = () => {
  return function (dispatch, getState) {
    dispatch(setConfigContent(getState().editor.formData));
  };
};

// this stores the original loaded config content (before any updates are made via the Form)
export const setConfigContentPreChange = (configContentPreChange) => ({
  type: SET_CONFIG_DATA_PRE_CHANGE,
  configContentPreChange,
});

// this stores the original loaded config content from a local file
export const setConfigContentLocal = (configContentLocal) => ({
  type: SET_CONFIG_DATA_LOCAL,
  configContentLocal,
});

// this sets the config content, e.g. for use as input in the editor Form
export const setConfigContent = (configContent) => ({
  type: SET_CONFIG_DATA,
  configContent,
});

export const resetLocalConfigList = () => ({
  type: RESET_LOCAL_CONFIG_LIST,
});
