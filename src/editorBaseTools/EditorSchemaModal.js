import React from "react";
import { connect } from "react-redux";
import * as actionsEditor from "../editorBase/actions";
import EditorDropdown from "./EditorDropdown";

class EditorSchemaModal extends React.Component {
  constructor(props) {
    super(props);
  }

  componentWillUnmount() {
    this.props.resetFiles()
  }

  render() {
    const {
      editorUISchemaFiles,
      editorSchemaFiles,
      editorConfigFiles,
      handleUploadedFile,
      selecteduischema,
      selectedschema,
      selectedconfig,
      handleDropdownChange,
      schemaAry,
      uiSchemaAry
    } = this.props;

    return (
      <div>
        <h4>Schema & config loader</h4>

        <EditorDropdown
          disabled={editorSchemaFiles.length == 0 ? true : false}
          options={editorUISchemaFiles}
          name="Presentation Mode"
          selected={selecteduischema}
          onChange={handleDropdownChange}
          handleUploadedFile={handleUploadedFile}
          schemaAry={schemaAry}
          uiSchemaAry={uiSchemaAry}
          customBackground={true}
          comment="The UIschema affects the visual presentation of the editor. It does not impact the Configuration File. It can also be used to hide e.g. advanced settings via a Simple variant - or show all settings via an Advanced variant."
        />
        <EditorDropdown
          disabled={editorConfigFiles.length == 0 ? true : false}
          options={editorSchemaFiles}
          name="Rule Schema"
          selected={selectedschema}
          onChange={handleDropdownChange}
          handleUploadedFile={handleUploadedFile}
          schemaAry={schemaAry}
          uiSchemaAry={uiSchemaAry}
          customBackground={true}
          comment="The Rule Schema serves as a guide for populating the Configuration File - and for automatically validating a Configuration File."
        /><hr/>
        <EditorDropdown
          disabled={false}
          options={editorConfigFiles}
          name="Configuration File"
          selected={selectedconfig}
          onChange={handleDropdownChange}
          handleUploadedFile={handleUploadedFile}
          schemaAry={schemaAry}
          uiSchemaAry={uiSchemaAry}
          comment="The Configuration File contains the settings that will be used on the device. You can upload a new Configuration File via the dropdown to modify it using the editor."
        />
      </div>
    );
  }
}

const mapDispatchToProps = dispatch => {
  return {
    handleUploadedFile: (file, type, schemaAry, uiSchemaAry) =>
      dispatch(actionsEditor.handleUploadedFile(file, type, schemaAry, uiSchemaAry)),
    resetFiles: () => dispatch(actionsEditor.resetFiles())
  };
};

export default connect(
  null,
  mapDispatchToProps
)(EditorSchemaModal);
