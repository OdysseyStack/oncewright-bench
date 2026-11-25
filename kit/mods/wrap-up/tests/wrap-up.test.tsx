import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const
const KIT = ['odyssey:wrap-up', 'odyssey:handoff']

// The world beneath the mod: context at `percent`, the commands the session lists, and a record of
// the commands the band runs.
const world = (on: On, percent: number, commands: string[] = KIT, beneath = '') => {
  const queued: string[] = []
  mock.env(on, { ODYSSEY_WRAPUP_PCT: '60' })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, tokens: percent * 2_000, percent }, rateLimits: [] } }))
  on('command.list', () => ({ value: commands.map(name => ({ name, description: '', source: 'plugin' })) }))
  on('command.run', (_$, e) => {
    queued.push(`/${e.command}${e.args ? ` ${e.args}` : ''}`)
    return { text: '' }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return beneath ? <Text>{beneath}</Text> : <Box />
  })
  return queued
}

test('past the mark, Wrap up queues one command, /odyssey:wrap-up, and the band goes', async ($, on) => {
  const queued = world(on, 72)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'wrap-up', surface, ...BAND })
    if (surface === 'terminal') {
      expect(await ui.find({ text: /^Context 72% used$/ })).toBeDefined()
      // A band Button takes only a digit from the prompt (a letter there is typed); peek's band has 1.
      expect((await ui.find({ key: 'wrap' }))?.props.hotkey).toBe('2')
      await ui.press({ key: 'wrap' })
      expect(queued).toEqual(['/odyssey:wrap-up'])
    }
    expect(await ui.find({ key: 'wrap' })).toBeUndefined()
    await ui.unmount()
  }
})

test('below the mark, the band stays away', async ($, on) => {
  world(on, 59)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'wrap-up', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'wrap' })).toBeUndefined()
  await ui.unmount()
})

test('without the kit loaded there is no command to run, so the band stays away', async ($, on) => {
  world(on, 90, [])
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'wrap-up', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'wrap' })).toBeUndefined()
  await ui.unmount()
})

test('a survey or Not now hides it', async ($, on) => {
  world(on, 80)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let ui = await $.ui.mount({ plugin: 'wrap-up', surface: 'terminal', ...BAND, props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.find({ key: 'wrap' })).toBeUndefined()
  await ui.unmount()
  ui = await $.ui.mount({ plugin: 'wrap-up', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'wrap' })).toBeDefined()
  await ui.press({ key: 'later' })
  expect(await ui.find({ key: 'wrap' })).toBeUndefined()
  await ui.unmount()
})

test("another plugin's line beneath (peek's band) still shows with the band", async ($, on) => {
  world(on, 72, KIT, '🔭 wrote README.md ·')
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'wrap-up', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: /^Context 72% used$/ })).toBeDefined()
  expect(await ui.find({ text: /🔭 wrote README\.md/ })).toBeDefined()
  await ui.unmount()
})
