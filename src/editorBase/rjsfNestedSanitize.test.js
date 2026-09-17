// @vitest-environment jsdom
import fs from 'fs'
import path from 'path'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, expect, it } from 'vitest'
import Form from '@rjsf/core'
import { createSchemaUtils } from '@rjsf/utils'
import validator from '@rjsf/validator-ajv8'

// Regression guard for the "locked selection" defect fixed in rjsf 6.10.1 (was
// worked around by EditorObjectField in 4.0.8, removed in 4.0.9): a nested
// `dependencies` branch that narrows a sibling select (frame_format FD ->
// Standard leaves brs: 1, which the Standard branch forbids) must be sanitized
// by the Form itself, because Form.getStateFromProps used to gate the sanitize
// step on the ROOT retrieved schema changing. Upstream rjsf #4465 / #3838.
// Also pins the two behaviours the 4.0.8 review flagged as must-not-change:
// inactive-branch data survives a branch switch, and dependency defaults are
// filled through the Form pipeline.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const schemaDir = path.join(process.cwd(), 'dist', 'schema')
const load = (...parts) => JSON.parse(fs.readFileSync(path.join(schemaDir, ...parts), 'utf8'))

// Mounts a live-validating Form and returns a driver that sets a field by path
// (the same path-based onChange a widget uses) and reads back the Form state.
async function mountForm(schema, formData) {
  const ref = React.createRef()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(Form, { ref, schema, formData, validator, liveValidate: true, onSubmit: () => {} }))
  })
  return {
    async set(pathList, value) {
      await act(async () => {
        ref.current.setFieldValue(pathList, value)
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      return ref.current.state
    },
    async unmount() {
      await act(async () => root.unmount())
      container.remove()
    }
  }
}

describe('rjsf Form sanitizes a nested dependencies branch switch', () => {
  it('corrects brs when the CANmod.router S-to-P message goes FD -> Standard', async () => {
    const form = await mountForm(load('CANmod.router', 'schema-01.02.json'), load('CANmod.router', 'config-01.02.json'))
    const messagePath = ['phy', 'can', 'route', 'mux', 's2p', 'message']

    let state = await form.set([...messagePath, 'frame_format'], 0)
    expect(state.formData.phy.can.route.mux.s2p.message).toEqual({ id_format: 0, id: '10', frame_format: 0, brs: 0 })
    expect(state.errors).toEqual([])

    // back to FD offers Enable again and keeps the data valid
    state = await form.set([...messagePath, 'frame_format'], 1)
    state = await form.set([...messagePath, 'brs'], 1)
    expect(state.formData.phy.can.route.mux.s2p.message).toEqual({ id_format: 0, id: '10', frame_format: 1, brs: 1 })
    expect(state.errors).toEqual([])
    await form.unmount()
  })

  it('corrects brs on a CANedge transmit row', async () => {
    const schema = load('CANedge2', 'schema-01.09.json')
    const config = createSchemaUtils(validator, schema).getDefaultFormState(schema)
    config.can_1.transmit = [{ name: 'm', state: 1, id_format: 0, frame_format: 1, brs: 1, log: 0, period: 1000, delay: 0, id: '1FF', data: '00' }]
    const form = await mountForm(schema, config)

    const state = await form.set(['can_1', 'transmit', 0, 'frame_format'], 0)
    expect(state.formData.can_1.transmit[0].brs).toBe(0)
    expect(state.errors).toEqual([])
    await form.unmount()
  })

  it('keeps inactive-branch data across route Mux -> Direct -> Mux', async () => {
    const config = load('CANmod.router', 'config-01.02.json')
    const form = await mountForm(load('CANmod.router', 'schema-01.02.json'), config)

    await form.set(['phy', 'can', 'route', 'mode'], 1)
    const state = await form.set(['phy', 'can', 'route', 'mode'], 0)

    expect(state.formData.phy.can.route.mux).toEqual(config.phy.can.route.mux)
    expect(state.errors).toEqual([])
    await form.unmount()
  })

  it('fills prescaler_value when a filter row picks a prescaling type', async () => {
    const schema = load('CANedge2', 'schema-01.09.json')
    const schemaUtils = createSchemaUtils(validator, schema)
    const config = schemaUtils.getDefaultFormState(schema)
    config.can_1.filter.id = [schemaUtils.getDefaultFormState(schema.definitions.can_filter_id.items)]
    const form = await mountForm(schema, config)

    const state = await form.set(['can_1', 'filter', 'id', 0, 'prescaler_type'], 1)
    expect(state.formData.can_1.filter.id[0].prescaler_value).toBe(1)
    expect(state.errors).toEqual([])
    await form.unmount()
  })
})
