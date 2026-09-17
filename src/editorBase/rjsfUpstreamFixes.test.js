import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { createSchemaUtils, findSchemaDefinition } from '@rjsf/utils'
import validator from '@rjsf/validator-ajv8'

// Regression guards for three rjsf 6 defects that 4.0.5-4.0.8 carried local
// workarounds for (omitExtraDataSafe, EditorArrayField, EditorObjectField).
// rjsf 6.10.1 fixed all three, the workarounds were removed in 4.0.9, and these
// tests pin the upstream behaviour so a future rjsf bump cannot silently bring
// a defect back. The sanitize case needs a rendered Form and lives in
// rjsfNestedSanitize.test.js.

const schemaDir = path.join(process.cwd(), 'dist', 'schema')
const load = (...parts) => JSON.parse(fs.readFileSync(path.join(schemaDir, ...parts), 'utf8'))
const clone = (x) => JSON.parse(JSON.stringify(x))

const listSchemaFiles = () => {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (/^schema-.*\.json$/.test(entry.name)) out.push(p)
    }
  }
  walk(schemaDir)
  return out
}

// every object-item array reachable in a schema, `$ref`s resolved
const objectItemArrays = (schema) => {
  const found = []
  const walk = (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return
    if (node.type === 'array' && node.items && typeof node.items === 'object' && !Array.isArray(node.items)) {
      const items = node.items.$ref ? findSchemaDefinition(node.items.$ref, schema) : node.items
      if (items && items.type === 'object') found.push(items)
    }
    Object.values(node).forEach(walk)
  }
  walk(schema)
  return found
}

describe('rjsf omitExtraData (was: browser hang on CANmod.router, rjsf #5196)', () => {
  // Pre-6.10 rjsf's omit() returned the SOURCE object by reference for an empty
  // `{}` patternProperties subschema; revisiting `mux` through the dependencies
  // oneOf then made handleArray() push into the array it was iterating. The
  // failure mode is a HANG, so a regression shows up as this run never finishing.
  it('terminates on the CANmod.router schema and keeps the config intact', () => {
    const schema = load('CANmod.router', 'schema-01.02.json')
    const config = load('CANmod.router', 'config-01.02.json')
    const schemaUtils = createSchemaUtils(validator, schema)

    expect(config.phy.can.route.mux.p2s.length).toBeGreaterThan(0)
    expect(schemaUtils.omitExtraData(schema, clone(config))).toEqual(config)
  })

  it('keeps inactive-branch data whitelisted by patternProperties', () => {
    // `phy.can.route` uses patternProperties {mux:{}, direct:{}} as an
    // additionalProperties:false whitelist, so `mux` must survive mode: direct.
    const schema = load('CANmod.router', 'schema-01.02.json')
    const config = load('CANmod.router', 'config-01.02.json')
    config.phy.can.route.mode = 1
    config.phy.can.route.direct = {}

    const result = createSchemaUtils(validator, schema).omitExtraData(schema, clone(config))

    expect(result.phy.can.route.mux).toEqual(config.phy.can.route.mux)
  })

  it('leaves every shipped default config untouched and terminates on every schema', () => {
    for (const file of listSchemaFiles()) {
      const schema = JSON.parse(fs.readFileSync(file, 'utf8'))
      const schemaUtils = createSchemaUtils(validator, schema)
      const configFile = file.replace(/schema-(.*)\.json$/, 'config-$1.json')
      const data = fs.existsSync(configFile)
        ? JSON.parse(fs.readFileSync(configFile, 'utf8'))
        : schemaUtils.getDefaultFormState(schema)

      expect(schemaUtils.omitExtraData(schema, clone(data)), file).toEqual(data)
    }
  })

  it('still drops values the schema does not describe', () => {
    const schema = load('CANmod.input', 'schema-01.04.json')
    const config = load('CANmod.input', 'config-01.04.json')
    const dirty = { ...config, bogus_section: { a: 1 } }

    expect(createSchemaUtils(validator, schema).omitExtraData(schema, dirty)).toEqual(config)
  })
})

describe('rjsf dependency defaults (was: rjsf #5198, both faces)', () => {
  const generic = {
    type: 'object',
    required: ['t'],
    properties: { t: { type: 'integer', default: 0 } },
    dependencies: {
      t: {
        oneOf: [
          { properties: { t: { enum: [0] }, p: { type: 'integer', default: 5 } }, required: ['p'] },
          { properties: { t: { enum: [1] } } }
        ]
      }
    }
  }

  it('populates a default living inside a dependencies branch with no form data (new row)', () => {
    const schemaUtils = createSchemaUtils(validator, generic)
    expect(schemaUtils.getDefaultFormState(generic, undefined)).toEqual({ t: 0, p: 5 })
  })

  it('applies dependency defaults to array items two object levels below the root', () => {
    const arr = { type: 'array', minItems: 1, items: generic }
    const deep = { type: 'object', properties: { f: { type: 'object', properties: { rows: arr } } } }
    const schemaUtils = createSchemaUtils(validator, deep)
    expect(schemaUtils.getDefaultFormState(deep, { f: { rows: [{ t: 0 }] } })).toEqual({ f: { rows: [{ t: 0, p: 5 }] } })
  })

  it('produces a valid CANedge ID-filter row on its own', () => {
    const schema = load('CANedge2', 'schema-01.09.json')
    const itemSchema = schema.definitions.can_filter_id.items
    const row = createSchemaUtils(validator, schema).getDefaultFormState(itemSchema)

    expect(row.prescaler_type).toBe(0)
    expect(validator.validateFormData(row, itemSchema).errors).toEqual([])
  })

  it('fills the value a newly picked prescaling type introduces, at the real nesting depth', () => {
    const schema = load('CANedge2', 'schema-01.09.json')
    const schemaUtils = createSchemaUtils(validator, schema)
    const config = schemaUtils.getDefaultFormState(schema)
    const row = schemaUtils.getDefaultFormState(schema.definitions.can_filter_id.items)
    config.can_1.filter.id = [{ ...row, prescaler_type: 1 }]
    delete config.can_1.filter.id[0].prescaler_value

    const filled = schemaUtils.getDefaultFormState(schema, config)

    expect(filled.can_1.filter.id[0].prescaler_value).toBe(1)
  })

  it('leaves no array row incomplete in any shipped schema', () => {
    // a row built with no form data must equal the same row fed back in
    let checked = 0
    for (const file of listSchemaFiles()) {
      const schema = JSON.parse(fs.readFileSync(file, 'utf8'))
      const schemaUtils = createSchemaUtils(validator, schema)
      for (const itemSchema of objectItemArrays(schema)) {
        const bare = schemaUtils.getDefaultFormState(itemSchema)
        expect(schemaUtils.getDefaultFormState(itemSchema, bare), file).toEqual(bare)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(100)
  })
})
