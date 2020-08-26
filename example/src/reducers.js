import { combineReducers } from "redux";
import alert from "./alert/reducer";

// import editor from "./editor/editorBase/reducer";
import editor from 'config-editor-base/src/editorBase/reducer'


const rootReducer = combineReducers({
  alert,
  editor,
});

export default rootReducer;
