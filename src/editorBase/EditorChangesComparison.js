import React from "react";
import { ReactGhLikeDiff } from "react-gh-like-diff";
import { connect } from "react-redux";
import Select from "react-select";
import _ from "lodash";
import { saveAs } from "file-saver";
import { crc32 } from "crc";
import { computeConfigDelta } from "./configDelta";


const selectOptions = (Files) => {
  Files = _.orderBy(Files, ["name"], ["desc"]);
  return [...Files, ...[{ name: "None" }]].map((File) => ({
    value: File.name,
    label: File.name,
  }));
};

let pastCrc32 = "N/A";

class EditorChangesComparison extends React.Component {
  constructor(props) {
    super(props);
    this.toggleCheckbox = this.toggleCheckbox.bind(this);
    this.handleSelectChange = this.handleSelectChange.bind(this);
    this.state = {
      hideWhiteSpace: true,
    };
  }

  toggleCheckbox = () => {
    this.setState({
      hideWhiteSpace: !this.state.hideWhiteSpace,
    });
  };

  handleSelectChange = (selectedValue) => {
    this.props.handleDropdownChange(
      selectedValue.value,
      "Previous Configuration File"
    );
  };

  // compute the partial config (change delta vs. the Previous Configuration
  // File) - returns null (with a user alert) when there is nothing to emit
  getPartialDelta = () => {
    const { past, current, showAlert } = this.props;

    let pastObj = null;
    try {
      pastObj = JSON.parse(past);
    } catch (e) {
      pastObj = null;
    }
    if (!pastObj || typeof pastObj !== "object") {
      if (showAlert) {
        showAlert("info", "Select a Previous Configuration File first");
      }
      return null;
    }

    const { partial, deletions } = computeConfigDelta(pastObj, current);

    if (!Object.keys(partial).length) {
      if (showAlert) {
        showAlert(
          "info",
          "No changes detected vs. the Previous Configuration File"
        );
      }
      return null;
    }

    if (deletions.length && showAlert) {
      showAlert(
        "warning",
        `${deletions.length} deleted setting(s) cannot be expressed in a partial config and were excluded: ${deletions.join(
          ", "
        )}`
      );
    }

    return { partial, deletions };
  };

  onDownloadPartial = () => {
    const delta = this.getPartialDelta();
    if (!delta) {
      return;
    }
    const { revisedConfigFile } = this.props;
    const fileName =
      "partial-" +
      ((revisedConfigFile && revisedConfigFile.value) || "config.json");
    const blob = new Blob([JSON.stringify(delta.partial, null, 2)], {
      type: "text/json",
    });
    saveAs(blob, fileName);
  };

  onTransferClick = () => {
    const delta = this.getPartialDelta();
    if (!delta) {
      return;
    }
    const { onTransferPartial, closeChangesModal, revisedConfigFile } =
      this.props;
    // restore body scrolling before the host navigates away
    closeChangesModal();
    onTransferPartial({
      partial: delta.partial,
      deletions: delta.deletions,
      configName: (revisedConfigFile && revisedConfigFile.value) || null,
    });
  };

  render() {
    const {
      options,
      selected,
      past,
      current,
      closeChangesModal,
      revisedConfigFile,
      crc32EditorLive,
      isCompareChanges,
      enableDownload,
      externalSubmit
    } = this.props;

    let pastCleaned = past && Object.keys(past).length ? JSON.stringify(JSON.parse(past), null, 2) : "";

    if (past && Object.keys(past).length) {
      pastCrc32 = crc32(past).toString(16).toUpperCase().padStart(8, "0");
    } else {
      pastCrc32 = "N/A";
    }

    // the partial-JSON buttons are only usable when a Previous Configuration
    // File is selected AND it yields a non-empty delta vs. the current config;
    // otherwise they render disabled (greyed) rather than alerting on click
    let partialAvailable = false;
    try {
      const pastObj = past ? JSON.parse(past) : null;
      if (pastObj && typeof pastObj === "object") {
        partialAvailable =
          Object.keys(computeConfigDelta(pastObj, current).partial).length > 0;
      }
    } catch (e) {
      partialAvailable = false;
    }

    return (
      <div
        className={
          isCompareChanges
            ? "show modal-custom-wrapper"
            : "hidden modal-custom-wrapper"
        }
      >
        <div
          className={
            isCompareChanges ? "show modal-custom" : "hidden modal-custom"
          }
        >
          <div>
            <div className="modal-review-changes-header">
              <button
                type="button"
                className="close"
                onClick={closeChangesModal}
              >
                <span style={{ color: "gray" }}>×</span>
              </button>
              <div className="">
                <h4> Review changes </h4>

                <div className="col-sm-6 zero-padding">
                  <p>
                    Previous Configuration File{" "}
                    <span className="device-file-table">
                      {pastCrc32 ? "[crc32: " + pastCrc32 + "]" : null}
                    </span>
                  </p>
                  <div className="col-sm-8 form-group pl0 field-string">
                    <Select
                      value={selected}
                      options={selectOptions(options)}
                      onChange={this.handleSelectChange}
                      isDisabled={
                        selectOptions(options).length == 1 &&
                        selectOptions(options)[0].value == "None"
                          ? true
                          : false
                      }
                      isSearchable={false}
                    />
                    <p className="field-description">
                      {
                        "This lets you select the benchmark (pre changes) Configuration File for comparison vs. the new updated Configuration File"
                      }
                    </p>
                    <div className="checkbox-white-space">
                      <label className="checkbox-design">
                        <input
                          label="Hide whitespace changes"
                          type="checkbox"
                          checked={this.state.hideWhiteSpace}
                          onChange={this.toggleCheckbox}
                        />{" "}
                        <span>&nbsp;Hide whitespace changes</span>
                      </label>
                    </div>
                  </div>
                </div>
                <div className="col-sm-6 zero-padding">
                  <p>
                    New Configuration File{" "}
                    <span className="device-file-table">
                      {crc32EditorLive
                        ? "[crc32: " + crc32EditorLive + "]"
                        : null}
                    </span>
                  </p>
                  <div className="col-sm-8 form-group pl0 field-string">
                    <Select
                      value={revisedConfigFile}
                      readOnly={true}
                      isSearchable={false}
                      isDisabled={true}
                      inputProps={{ readOnly: true }}
                    />
                    <p className="field-description">
                      {"This will be the name of the new Configuration File"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-custom-content">
              <div>
                <ReactGhLikeDiff
                  options={{
                    originalFileName: "original_config",
                    updatedFileName: "new_config",
                    matchWordsThreshold: 0.25,
                    matchingMaxComparisons: 5000,
                  }}
                  past={this.state.hideWhiteSpace ? pastCleaned : past}
                  current={JSON.stringify(current, null, 2)}
                />
              </div>
            </div>
          </div>

          <div className="modal-custom-footer">
            <button type="submit" className="btn btn-primary" disabled={!externalSubmit}>
              {" "}
              Submit to S3{" "}
            </button>{" "}
            <button
              type="submit"
              onClick={enableDownload}
              className="btn btn-primary ml15"
            >
              {" "}
              Download to disk{" "}
            </button>
            <button
              type="button"
              onClick={this.onDownloadPartial}
              className="btn btn-white ml15"
              disabled={!partialAvailable}
              title="Download the delta changes as a partial config JSON e.g. for application across multiple devices"
            >
              {" "}
              Download partial JSON to disk{" "}
            </button>
            {typeof this.props.onTransferPartial === "function" ? (
              <button
                type="button"
                onClick={this.onTransferClick}
                className="btn btn-white ml15"
                disabled={!partialAvailable}
                title="Transfer the delta changes as a partial config JSON to the OTA batch manager for application across multiple devices"
              >
                {" "}
                Transfer to OTA batch manager{" "}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
}

function mapStateToProps(state) {
  return {
    past: state.editor.configContentPreChange,
    current: state.editor.configContent,
    crc32EditorLive: state.editor.crc32EditorLive,
  };
}

export default connect(mapStateToProps)(EditorChangesComparison);
