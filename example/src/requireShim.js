// config-editor-base's loadFile() uses a dynamic CommonJS require
// (require(`./schema/${type}/${name}`)) to pull the embedded schema files out of
// dist/schema. Webpack consumers turn that into a context module automatically;
// under Vite there is no `require`, so this shim emulates it with an eager glob.
// It must be imported before anything that renders the editor.
//
// react-gh-like-diff additionally calls require('diff2html') lazily inside a
// function body, which survives Vite's production CommonJS conversion - serve
// that from here too.
import * as diff2html from 'diff2html'

const lazyCjsModules = {
  diff2html: diff2html
}

const schemaModules = import.meta.glob('../../dist/schema/**/*.json', { eager: true })

window.require = (path) => {
  if (lazyCjsModules[path]) {
    return lazyCjsModules[path]
  }
  // loadFile passes paths like './schema/CANedge2/schema-01.09.json'
  const key = '../../dist' + path.slice(1)
  const mod = schemaModules[key]
  if (!mod) {
    throw new Error('requireShim: module not available: ' + path)
  }
  return mod.default || mod
}
