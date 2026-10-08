import {
  isValidConfig,
  isValidSchema,
  isGenericConfig,
  isGenericSchema,
  isGenericUISchema,
} from "./utils";
import {
  handleUploadedFile,
  SET_CONFIG_LIST,
  SET_SCHEMA_DATA,
  RESET_SCHEMA_LIST,
} from "./actions";

describe("non-revisioned file predicates", () => {
  it("accepts the webCAN settings file names", () => {
    expect(isGenericConfig("webcan-settings-v1.json")).toBe(true);
    expect(isGenericSchema("webcan-settings-schema-v1.json")).toBe(true);
    expect(isGenericUISchema("webcan-settings-uischema-v1.json")).toBe(true);
  });

  it("keeps the schema/uischema guards against picking a config file", () => {
    expect(isGenericSchema("webcan-settings-v1.json")).toBe(false);
    expect(isGenericUISchema("webcan-settings-schema-v1.json")).toBe(false);
    expect(isGenericConfig("webcan-settings-v1.txt")).toBe(false);
  });

  it("leaves the revisioned predicates unchanged", () => {
    expect(isValidConfig("config-01.09.json")).toBe(true);
    expect(isValidConfig("webcan-settings-v1.json")).toBe(false);
    expect(isValidSchema("webcan-settings-schema-v1.json")).toBe(false);
  });
});

describe("handleUploadedFile (config)", () => {
  let originalFileReader;

  beforeAll(() => {
    originalFileReader = global.FileReader;
    // minimal synchronous FileReader stub: the File stand-in carries its text
    global.FileReader = class {
      readAsText(file) {
        this.result = file.text;
        this.onloadend();
      }
    };
  });

  afterAll(() => {
    global.FileReader = originalFileReader;
  });

  const upload = (name, content, schemaFiles) => {
    const actions = [];
    const thunks = [];
    const state = { editor: { editorSchemaFiles: schemaFiles, formData: null } };
    const dispatch = (action) => {
      if (typeof action === "function") {
        thunks.push(action);
        return;
      }
      actions.push(action);
    };
    const file = { name, text: JSON.stringify(content) };
    handleUploadedFile(file, "Configuration File", ["schema-01.09.json | CANedge2"], [])(
      dispatch,
      () => state
    );
    return { actions, thunks };
  };

  const canedgeConfig = { can_1: {}, can_2: {}, connect: { wifi: {} } };
  const webcanConfig = { webcan_settings_version: 1, sections: {} };

  it("still auto-loads the embedded schema for a revisioned config", () => {
    const { actions, thunks } = upload("config-01.09.json", canedgeConfig, []);
    // publicSchemaFiles + setUpdatedFormData are the two thunks
    expect(thunks.length).toBe(2);
    expect(actions.some((a) => a.type === SET_SCHEMA_DATA)).toBe(false);
    const configList = actions.find((a) => a.type === SET_CONFIG_LIST);
    expect(configList.configFiles[0].name).toBe("config-01.09.json (local)");
  });

  it("loads a non-revisioned config without auto-load and clears an embedded schema", () => {
    const { actions, thunks } = upload("webcan-settings-v1.json", webcanConfig, [
      { name: "schema-01.09.json | CANedge2", selected: true },
    ]);
    // only setUpdatedFormData - no publicSchemaFiles
    expect(thunks.length).toBe(1);
    expect(actions.find((a) => a.type === RESET_SCHEMA_LIST).schemaFiles).toEqual([]);
    expect(actions.find((a) => a.type === SET_SCHEMA_DATA).schemaContent).toBe(null);
    const configList = actions.find((a) => a.type === SET_CONFIG_LIST);
    expect(configList.configFiles[0].name).toBe("webcan-settings-v1.json (local)");
  });

  it("keeps an uploaded (local) schema when loading a non-revisioned config", () => {
    const { actions } = upload("webcan-settings-v1.json", webcanConfig, [
      { name: "webcan-settings-schema-v1.json (local)", selected: true },
    ]);
    expect(actions.some((a) => a.type === RESET_SCHEMA_LIST)).toBe(false);
    expect(actions.some((a) => a.type === SET_SCHEMA_DATA)).toBe(false);
  });
});
