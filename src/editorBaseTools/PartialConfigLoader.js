import React from "react";
import { connect } from "react-redux";
import Files from "react-files";
import * as actionsEditor from "../editorBase/actions";
import validator from "@rjsf/validator-ajv8";
import Form from "@rjsf/core";

let yourForm;
import merge from "deepmerge";

class PartialConfigLoader extends React.Component {
  constructor(props) {
    super(props);

    this.onReview = this.onReview.bind(this);
    this.onFilesError = this.onFilesError.bind(this);
    this.testMergedFile = this.testMergedFile.bind(this);
    this.onSubmit = this.onSubmit.bind(this);
    this.onValidationError = this.onValidationError.bind(this);

    this.state = {
      jsonFile: {},
      jsonFileName: "",
      mergedConfig: {},
      mergedConfigValid: "Unknown",
    };

    this.fileReader = new FileReader();

    this.fileReader.onload = (event) => {
      try {
        this.setState({ jsonFile: JSON.parse(event.target.result) }, () => {
          this.testMergedFile();
        });
      } catch (e) {
        this.onFilesError(e);
      }
    };
  }

  onSubmit() {
    this.setState({ mergedConfigValid: true }, () => {});
  }

  onValidationError() {
    this.setState({ mergedConfigValid: false }, () => {});
  }

  testMergedFile() {
    // Use deepmerge's built-in arrayMerge option to overwrite arrays
    const overwriteMerge = (destinationArray, sourceArray, options) => sourceArray;

    let mergedConfigTemp = merge(this.props.formData, this.state.jsonFile, {
      arrayMerge: overwriteMerge,
    });

    this.setState({ mergedConfig: mergedConfigTemp }, () => {
      yourForm.submit();
    });
  }

  onFileChange(file) {
    this.setState({ jsonFileName: file[0].name }, () => {});
  }

  onFilesError(error) {
    this.setState({ jsonFile: {}, jsonFileName: "" }, () => {
      this.props.showAlert("info", "Invalid JSON file - " + error.message);
    });
  }

  onReview() {
    console.log(this.state.mergedConfig);
    this.props.setConfigContent(this.state.mergedConfig);

    this.setState({ jsonFile: {}, jsonFileName: "" }, () => {
      this.props.showAlert(
        "success",
        "Merged partial Configuration File with editor Configuration File"
      );
      this.props.setUpdatedFormData(this.state.mergedConfig);
    });
  }

  render() {
    const {
      jsonFile,
      jsonFileName,
      mergedConfig,
      mergedConfigValid,
    } = this.state;
    const { formData, schemaContent } = this.props;

    return (
      <div>
        <h4>Partial config loader</h4>

        <div>
          <div className="form-group pl0 field-string">
            <p className="field-description field-description-shift">
              Select a JSON file containing a partial Configuration File. This
              lets you e.g. load a list of transmit messages or filters. The
              loaded JSON is validated vs. the Rule Schema, after which it can
              be merged into the editor Configuration File (even if it is not
              valid)
            </p>
          </div>
          <div>
            {formData ? (
              <div className="text-area-wrapper row no-gutters reduced-margin">
                <div className="file-dropzone">
                  <Files
                    onChange={(file) => {
                      file.length
                        ? (this.onFileChange(file),
                          this.fileReader.readAsText(file[0]))
                        : this.onFilesError;
                    }}
                    onError={(error) => {
                      this.onFilesError(error);
                    }}
                    accepts={[".json"]}
                    multiple={false}
                    maxFileSize={10000000}
                    minFileSize={0}
                    clickable
                  >
                    <button
                      className="btn btn-primary"
                      title="Upload a partial Configuration File to merge it"
                    >
                      Load JSON file
                    </button>
                    <div className="browse-file-name">{jsonFileName}</div>
                  </Files>
                </div>

                {Object.keys(jsonFile).length ? (
                  <div className="text-area-wrapper row no-gutters">
                    <pre className="browse-file-preview">
                      {JSON.stringify(jsonFile, null, 2)}
                    </pre>

                    {formData ? (
                      <div>
                        {mergedConfigValid ? (
                          <div
                            className="btn-highlight"
                            style={{ fontSize: "12px", marginBottom: "8px" }}
                          >
                            <i className="fa fa-check" /> Merged Configuration
                            File validated
                          </div>
                        ) : null}
                        {!mergedConfigValid ? (
                          <div
                            className="red-text"
                            style={{ fontSize: "12px", marginBottom: "8px" }}
                          >
                            <i className="fa fa-times" /> Merged Configuration
                            File is invalid
                          </div>
                        ) : null}
                        <button
                          className="btn btn-primary"
                          onClick={this.onReview}
                        >
                          Merge files
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="widget-no-data">
                <br />
                <p>Pending editor Configuration File ...</p>
              </div>
            )}

            <div style={{ display: "none" }}>
              {JSON.stringify(mergedConfig, null, 2)}
              <Form
                validator={validator}
                onError={this.onValidationError}
                schema={schemaContent ? schemaContent : {}}
                formData={mergedConfig ? mergedConfig : {}}
                onSubmit={this.onSubmit}
                ref={(form) => {
                  yourForm = form;
                }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }
}

const mapStateToProps = (state) => {
  return {
    formData: state.editor.formData,
    schemaContent: state.editor.schemaContent,
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

export default connect(mapStateToProps, mapDispatchToProps)(PartialConfigLoader);
