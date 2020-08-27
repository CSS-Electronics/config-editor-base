import { combineReducers } from "redux";
import alert from "./alert/reducer";

import editor from 'config-editor-base/src/editorBase/reducer'
import {editorReducer} from 'config-editor-base'

const rootReducer = combineReducers({
  alert,
  editorReducer,
});

export default rootReducer;
