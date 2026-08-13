import React from 'react'
import { connect } from 'react-redux'

import classNames from 'classnames'
import validator from "@rjsf/validator-ajv8";
import Form from "@rjsf/core";

import EditorSchemaModal from '../editorBaseTools/EditorSchemaModal'
import PartialConfigLoader from '../editorBaseTools/PartialConfigLoader'

import EditorToolButton from '../editorBaseTools/EditorToolButton'
import EditorToolModalWrapper from '../editorBaseTools/EditorToolModalWrapper'

import applyNav from 'rjsf-tabs'
import EditorNavs from './EditorNavs'
import { flushSync } from 'react-dom'
import ArrayFieldTemplate, { ArrayFieldItemTemplate } from './EditorArrayFieldTemplate'
import FieldTemplate from './EditorFieldTemplate'
import ObjectFieldTemplate from './EditorObjectFieldTemplate'
import BaseInputTemplate, { flushPendingInputs } from './EditorBaseInputTemplate'
import EditorChangesComparison from './EditorChangesComparison'

import * as actionsEditor from './actions'
import { getFileType } from './utils'

const regexRevision = new RegExp('\\d{2}\\.\\d{2}\\.json', 'g')
let isDownloadConfig = false
let activatedTab

// rjsf 6 skips validation on mount (constructor passes skipLiveValidate=true
// to getStateFromProps; v5 validated). Because this editor REMOUNTS the Form
// on every UI transition (tool sidebar open/close, modal close - the remount
// is load-bearing, see applyNav note), any open validation errors visibly
// vanished until the next edit. Validate once after mount, mirroring the
// liveValidate path (errors only - deliberately NOT validateForm(), which
// would fire onError and pop the "config contains validation errors" alert).
// A ref wrapper rather than `class extends Form`: microbundle transpiles
// subclasses to ES5-style constructors, which cannot extend rjsf's native ES
// class ("Class constructor _Form cannot be invoked without 'new'").
const LiveValidatedForm = (props) => {
  const formRef = React.useRef(null)
  React.useEffect(() => {
    const form = formRef.current
    if (!form || !props.liveValidate || props.noValidate) return
    const schemaValidation = form.validate(form.state.formData)
    if (schemaValidation.errors.length > 0) {
      form.setState({
        errors: schemaValidation.errors,
        errorSchema: schemaValidation.errorSchema,
        schemaValidationErrors: schemaValidation.errors,
        schemaValidationErrorSchema: schemaValidation.errorSchema
      })
    }
    // mount-only: this wrapper remounts together with the Form itself
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <Form ref={formRef} {...props} />
}

export class EditorSection extends React.Component {
  constructor(props) {
    super(props)
    this.editorForm = React.createRef()
    this.handleCompareChanges = this.handleCompareChanges.bind(this)
    this.closeChangesModal = this.closeChangesModal.bind(this)
    this.handleError = this.handleError.bind(this)
    this.onSubmit = this.onSubmit.bind(this)
    this.escFunction = this.escFunction.bind(this)
    this.subMenuBtnClick = this.subMenuBtnClick.bind(this)
    this.handleDropdownChange = this.handleDropdownChange.bind(this)
    this.hideUischemaModal = this.hideUischemaModal.bind(this)

    this.state = {
      showUischemaModal: true,
      schema: '',
      selecteduischema: '',
      selectedschema: '',
      selectedconfig: '',
      configreview: { value: 'None', label: 'None' },
      revisedConfigFile: {},
      formData: {},
      isSubmitting: false,
      isDownloadConfig: false,
      isCompareChanges: false,
      activeSideBar: 'schema-modal',
      isSideBarExpanded: false
    }

    this.toggleSideBarExpand = this.toggleSideBarExpand.bind(this)
    this.input = ''
    this.s3 = this.props.fetchFileContentExt ? true : false
  }

  escFunction(event) {
    if (event.keyCode === 27) {
      this.closeChangesModal()
    }
  }

  subMenuBtnClick(name) {
    let sideBar = this.state.activeSideBar == name ? 'none' : name

    // synchronously flush any debounced pending input edits into the Form and
    // through its onChange into the store (flushSync forces the setState
    // callback chain to complete), then sync configContent from the live
    // formData before the state change re-renders the form
    flushSync(() => flushPendingInputs())
    this.props.setConfigContentPreSubmit()

    this.setState({
      activeSideBar: sideBar,
      isSideBarExpanded: sideBar === 'none' ? false : this.state.isSideBarExpanded
    })
  }

  toggleSideBarExpand() {
    // flush pending debounced edits synchronously, then sync configContent
    // from the live formData before the state change re-renders the form
    flushSync(() => flushPendingInputs())
    this.props.setConfigContentPreSubmit()
    this.setState({ isSideBarExpanded: !this.state.isSideBarExpanded })
  }

  hideUischemaModal(){
    flushSync(() => flushPendingInputs())
    this.props.setConfigContentPreSubmit()
    this.setState({ showUischemaModal: false })
  }
  

  handleDropdownChange(selection, dropdown) {
    const fileType = getFileType(dropdown)
    this.setState(
      {
        [fileType]: selection,
        ['selected' + fileType]: selection,
        [fileType.replace('-', '')]: { value: selection, label: selection }
      },
      () => {
        if (
          this.s3 &&
          !selection.includes('Simple') &&
          !selection.includes('Advanced') &&
          !selection.includes('(local)')
        ) {
          this.props.fetchFileContentExt(selection, fileType)
        } else {
          this.props.fetchFileContent(selection, fileType)
        }
      }
    )
  }

  handleCompareChanges(e) {
    this.setState({
      isCompareChanges: !this.state.isCompareChanges
    })
  }

  closeChangesModal(e) {
    // triggered via ESC too (no blur happens then) - flush pending debounced
    // input edits and sync them into configContent before the setState
    // re-render remounts the form, so they are not reset
    flushSync(() => flushPendingInputs())
    this.props.setConfigContentPreSubmit()
    this.setState({
      isCompareChanges: false
    })
    document.body.style.overflow = 'auto'
  }

  enableDownload() {
    isDownloadConfig = true
  }

  UNSAFE_componentWillMount() {
    this.props.publicUiSchemaFiles(
      this.props.uiSchemaAry,
      this.props.schemaAry,
      this.props.demoMode
    )
  }

  componentDidMount() {
    document.addEventListener('keydown', this.escFunction, false)
  }

  componentWillUnmount() {
    document.removeEventListener('keydown', this.escFunction, false)
  }

  UNSAFE_componentWillReceiveProps(nextProps) {
    let uiLocal = nextProps.editorUISchemaFiles.filter((file) =>
      file.name.includes('(local)')
    )
    let schemaLocal = nextProps.editorSchemaFiles.filter((file) =>
      file.name.includes('(local)')
    )
    let configLocal = nextProps.editorConfigFiles.filter((file) =>
      file.name.includes('(local)')
    )

    if (uiLocal.length) {
      this.setState({
        selecteduischema: uiLocal[0].name
      })
    }
    if (schemaLocal.length) {
      this.setState({
        selectedschema: schemaLocal[0].name
      })
    }
    if (configLocal.length) {
      this.setState({
        selectedconfig: configLocal[0].name
      })
    }

    // Get the initial value for the config review benchmark dropdown
    if (nextProps.editorConfigFiles.length == 0) {
      this.setState({
        configreview: { value: 'None', label: 'None' }
      })
    }

    if (
      this.props.editorConfigFiles.length !=
        nextProps.editorConfigFiles.length &&
      nextProps.editorConfigFiles[0] &&
      nextProps.editorConfigFiles[0].name
    ) {
      let configName = configLocal.length
        ? configLocal[0].name
        : nextProps.editorConfigFiles[0].name

      this.setState(
        {
          configreview: { value: configName, label: configName }
        },
        () => {
          if (configName.includes('(local)')) {
            this.props.fetchFileContent(configName, 'config-review')
          } else if (this.s3) {
            this.props.fetchFileContentExt(configName, 'config-review')
          }
        }
      )
    }
  }

  onSubmit({ formData }) {
    if (
      this.props.schemaContent == undefined ||
      this.props.schemaContent == null
    ) {
      this.props.showAlert('info', 'No Rule Schema has been loaded')
      return
    }

    let checkSchemaList = this.props.editorSchemaFiles.length
      ? this.props.editorSchemaFiles[0].name
      : null

    const checkSchemaUpload = this.props.editorSchemaFiles.filter((file) =>
      file.name.includes('(local)')
    )
    let checkUpload = null

    if (checkSchemaUpload.length) {
      checkUpload = checkSchemaUpload[0].name.split(' ')[0]
    }

    this.setState(
      {
        schema: checkUpload
          ? checkUpload
          : this.state.selectedschema
          ? this.state.selectedschema
          : checkSchemaList,
        formData,
        isSubmitting: true
      },
      () => {
        let tempJson = JSON.stringify(formData, null, 2)
        this.props.setConfigContent(JSON.parse(tempJson))

        let revisedConfigFileSchema = this.state.schema

        let revisedConfigFile = `config-${revisedConfigFileSchema.match(
          regexRevision
        )}`

        if (this.state.isCompareChanges === false) {
          // Run all configuration warning checks when Review Changes button is clicked
          this.props.runConfigurationWarningChecks(formData)
          
          this.setState({
            isCompareChanges: true,
            revisedConfigFile: {
              value: revisedConfigFile,
              label: revisedConfigFile
            }
          })
          document.body.style.overflow = 'hidden'
        } else {
          if (isDownloadConfig) {
            this.props.saveUpdatedConfiguration(revisedConfigFile, formData)
            isDownloadConfig = false
            document.body.style.overflow = 'auto'
            this.setState({
              isCompareChanges: false
            })
          } else {
            this.props.updateConfigFileExt(
              JSON.stringify(formData, null, 2),
              `${revisedConfigFile}`
            )
            document.body.style.overflow = 'auto'
            this.setState({
              isCompareChanges: false
            })
          }
        }
      }
    )
  }

  handleError(errors) {
    isDownloadConfig = false
    this.props.showAlert(
      'danger',
      'The config contains validation errors (see top of editor) - please review and try again'
    )
  }

  handleChange = ({ formData }) => {
    this.props.setUpdatedFormData(formData)
  }

  onNavChange = (nav) => {
    activatedTab = nav[0]
  }

  render() {
    const {
      editorSchemaFiles,
      editorConfigFiles,
      editorUISchemaFiles,
      configContent,
      uiContent,
      schemaContent,
      editorTools,
      sideBarPadding
    } = this.props

    let editorUISchemaFile = editorUISchemaFiles[0] ? editorUISchemaFiles[0].name : ""
    let editorUIAdvancedSimpleTest = editorUISchemaFile.includes("Simple") || editorUISchemaFile.includes("Advanced")

    // add navigation bar
    let FormWithNav = schemaContent
      ? applyNav(LiveValidatedForm, EditorNavs)
      : LiveValidatedForm

    // add the default 'base modals' to the modals list
    let editorToolsFull = editorTools.concat(
      {
        name: 'partialconfig-modal',
        comment: 'Partial config loader',
        class: 'fa fa-plus',
        modal: <PartialConfigLoader showAlert={this.props.showAlert} />
      },

      {
        name: 'schema-modal',
        comment: 'Schema & config loader',
        class: 'fa fa-cog',
        modal: (
          <EditorSchemaModal
            selecteduischema={this.state.selecteduischema}
            selectedschema={this.state.selectedschema}
            selectedconfig={this.state.selectedconfig}
            editorUISchemaFiles={editorUISchemaFiles}
            editorSchemaFiles={editorSchemaFiles}
            editorConfigFiles={editorConfigFiles}
            handleDropdownChange={this.handleDropdownChange}
            schemaAry={this.props.schemaAry}
            uiSchemaAry={this.props.uiSchemaAry}
          />
        )
      }
    )

    return (
      <div>
        <div
          className={classNames({
            'config-editor fe-header': true,
            'encryption-padding': this.state.activeSideBar != 'none' && !this.state.isSideBarExpanded,
            'encryption-padding-expanded': this.state.activeSideBar != 'none' && this.state.isSideBarExpanded
          })}
        >
          <header className='top-header-offline' />

          {editorToolsFull.map((modal, idx) => (
            <div
              key={idx}
              style={{
                display: modal.name == this.state.activeSideBar ? '' : 'none'
              }}
            >
              <EditorToolModalWrapper
                modal={modal.modal}
                name={modal.name}
                onClick={() => this.subMenuBtnClick('none')}
                isExpanded={this.state.isSideBarExpanded}
                onToggleExpand={this.toggleSideBarExpand}
              />
            </div>
          ))}

          <div>
            <br />
            <br />
            <br />
            <br />

            <div>
              {(editorConfigFiles.length == 0 && this.props.demoMode == false) ? (
                <div className='schema-loader-callout config-loader'>
                  <p className='loader-callout'>
                    Load your Configuration File <br />
                    (config-XX.YY.json)
                  </p>
                </div>
              ) : null}

              {editorConfigFiles.length != 0 &&
              editorSchemaFiles.length == 0 ? (
                <div className='schema-loader-callout schema-loader'>
                  <p className='loader-callout'>
                    Load your Rule Schema File <br />
                    (schema-XX.YY.json)
                  </p>
                </div>
              ) : null}

              {editorConfigFiles.length != 0 &&
              editorSchemaFiles.length != 0 &&
              editorUISchemaFiles.length == 0 ? (
                <div className='schema-loader-callout uischema-loader'>
                  <p className='loader-callout'>
                    Load your UIschema File <br />
                    (uischema-XX.YY.json)
                  </p>
                </div>
              ) : null}

              {editorConfigFiles.length != 0 &&
              editorSchemaFiles.length != 0 &&
              editorUIAdvancedSimpleTest == true ? (
                <div onClick={this.hideUischemaModal} className='schema-loader-callout uischema-loader fadeout-box'
                style={{display: this.state.showUischemaModal ? 'block' : 'none' }}>
                  <p className='loader-callout'>
                    Change 'Presentation Mode' to unhide/hide advanced settings
                  </p>
                </div>
              ) : null}

              <FormWithNav
               validator={validator}
                omitExtraData={true}
                liveOmit={true}
                liveValidate={true}
                noHtml5Validate={true}
                schema={schemaContent ? schemaContent : {}}
                uiSchema={uiContent ? uiContent : {}}
                formData={configContent ? configContent : {}}
                onSubmit={this.onSubmit}
                onChange={this.handleChange}
                onError={this.handleError}
                onNavChange={this.onNavChange.bind(this)}
                templates={{ArrayFieldTemplate, ArrayFieldItemTemplate, FieldTemplate, ObjectFieldTemplate, BaseInputTemplate}}
                activeNav={activatedTab}
              >
                <EditorChangesComparison
                  isCompareChanges={this.state.isCompareChanges}
                  revisedConfigFile={this.state.revisedConfigFile}
                  options={editorConfigFiles}
                  selected={this.state.configreview}
                  handleDropdownChange={this.handleDropdownChange}
                  closeChangesModal={this.closeChangesModal}
                  enableDownload={this.enableDownload.bind(this)}
                  externalSubmit={this.props.fetchFileContentExt ? true : false}
                  showAlert={this.props.showAlert}
                  onTransferPartial={this.props.onTransferPartial}
                />

                <div
                  className={classNames({
                    'config-bar': true,
                    'fe-sidebar-shift-offline': !sideBarPadding
                  })}
                >
                  <div className='col-xs-1' style={{ minWidth: '120px' }}>
                    <button
                      type='submit'
                      className={classNames({
                        btn: true,
                        'btn-primary': editorSchemaFiles.length != 0,
                        'btn-disabled': editorSchemaFiles.length == 0
                      })}
                    >
                      {' '}
                      Review changes{' '}
                    </button>
                  </div>
                  <div className='col-xs-7' style={{ float: 'left', display: 'flex', alignItems: 'center' }}>
                    {editorToolsFull.map((modal, idx) => (
                      <EditorToolButton
                        key={idx}
                        onClick={() => this.subMenuBtnClick(modal.name)}
                        comment={modal.comment}
                        className={modal.class}
                      />
                    ))}
              
                  </div>
                </div>
              </FormWithNav>
            </div>
          </div>
        </div>
        <div className='config-bar-background' />
      </div>
    )
  }
}

const mapStateToProps = (state) => {
  return {
    editorSchemaFiles: state.editor.editorSchemaFiles,
    editorConfigFiles: state.editor.editorConfigFiles,
    editorUISchemaFiles: state.editor.editorUISchemaFiles,
    schemaContent: state.editor.schemaContent,
    configContent: state.editor.configContent,
    uiContent: state.editor.uiContent,
    configContentPreChange: state.editor.configContentPreChange
  }
}

const mapDispatchToProps = (dispatch) => {
  return {
    fetchFileContent: (fileName, fileType) =>
      dispatch(actionsEditor.fetchFileContent(fileName, fileType)),
    setConfigContent: (content) =>
      dispatch(actionsEditor.setConfigContent(content)),
    saveUpdatedConfiguration: (filename, content) =>
      dispatch(actionsEditor.saveUpdatedConfiguration(filename, content)),
    setUpdatedFormData: (formData) =>
      dispatch(actionsEditor.setUpdatedFormData(formData)),
    setConfigContentPreSubmit: () =>
      dispatch(actionsEditor.setConfigContentPreSubmit()),
    publicUiSchemaFiles: (uiSchemaAry, schemaAry, demoMode) =>
      dispatch(
        actionsEditor.publicUiSchemaFiles(uiSchemaAry, schemaAry, demoMode)
      ),
    runConfigurationWarningChecks: (content) =>
      dispatch(actionsEditor.runConfigurationWarningChecks(content))
  }
}

export default connect(mapStateToProps, mapDispatchToProps)(EditorSection)
