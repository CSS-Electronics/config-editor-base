// -------------------------------------------------------
// UTILS: Utils for testing schema name validity

// Toggle demo mode on/off
// export const demoMode = false
export const demoConfig = 'config-01.09.json'

export const regexUISchemaPublic = new RegExp(
  /^uischema-\d{2}\.\d{2}\.json/,
  'g'
)

export const regexSchemaPublic = new RegExp(/^schema-\d{2}\.\d{2}\.json/, 'g')

export const isValidUISchema = (file) => {
  const regexUiSchema = new RegExp('uischema-\\d{2}\\.\\d{2}\\.json', 'g')
  return regexUiSchema.test(file)
}

export const isValidSchema = (file) => {
  const regexSchema = new RegExp('schema-\\d{2}\\.\\d{2}\\.json', 'g')
  return regexSchema.test(file)
}

export const isValidConfig = (file) => {
  const regexConfig = new RegExp('config-\\d{2}\\.\\d{2}.{0,35}\\.json', 'g')
  return regexConfig.test(file)
}

export const getFileType = (dropdown) => {
  let type = ''
  switch (true) {
    case dropdown == 'Presentation Mode':
      type = 'uischema'
      break
    case dropdown == 'Rule Schema':
      type = 'schema'
      break
    case dropdown == 'Configuration File':
      type = 'config'
      break
    case dropdown == 'Previous Configuration File':
      type = 'config-review'
      break
    default:
      type = 'invalid'
  }
  return type
}

// load local embedded schema files for user convenience
export const loadFile = (fileName) => {
  try {
    const schema = require(`./schema/${fileName.split(' | ')[1]}/${
      fileName.split(' ')[0]
    }`)
    return schema
  } catch (e) {
    console.log(e)
      return null
  }
}

// CRC32: Calculate crc32 of Configuration File
const { detect } = require('detect-browser')
const browser = detect()

export const crcBrowserSupport = [
  'chrome',
  'firefox',
  'opera',
  'safari',
  'edge'
].includes(browser.name)
