import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const mark = atom({ plugin: 'wrap-up', key: 'mark' } as const, null)
const isHidden = atom({ plugin: 'wrap-up', key: 'isHidden' } as const, false)

// The status bar's wrap-up mark: ODYSSEY_WRAPUP_PCT (the environment's, else the settings' env) when
// it is above 0 and at most 100, else 35. The band shows from that percent of context on, and only
// in a session that loaded the kit, whose command it runs.
const measure = async ($: EngineInterface) => {
  const set =
    (await $.env.get('ODYSSEY_WRAPUP_PCT')) ??
    ((await $.settings.read()).env as Record<string, string> | undefined)?.ODYSSEY_WRAPUP_PCT
  const n = Number(set)
  const { context } = await $.session.usage()
  const percent = context.percent
  const kit = (await $.command.list()).some(command => command.name === 'odyssey:wrap-up')
  await update($, mark, () => (percent === undefined || !kit ? null : { percent, limit: n > 0 && n <= 100 ? n : 35 }))
}

// One command, run as the person would type it once the session is idle: /odyssey:wrap-up saves
// memory and then writes the handoff itself. A second queued command would be fed in as
// the answer to any question the first one asks.
const wrapUp = async ($: EngineInterface) => {
  await update($, isHidden, () => true)
  await $.command.run({ command: 'odyssey:wrap-up', args: '' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await measure($)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId) await measure($)
    return done
  })

  // Drawn with whatever the plugins beneath draw above the prompt (peek's band), never instead of it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const now = await read($, mark)
    if (e.props.hasSurvey || !now || now.percent < now.limit || (await read($, isHidden))) return below
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text>{`Context ${now.percent}% used`}</Text>
          <Button key="wrap" hotkey="2" label="Wrap up" variant="primary" onPress={() => void wrapUp($)} />
          <Button key="later" label="Not now" onPress={() => void update($, isHidden, () => true)} />
        </Box>
        {below}
      </Box>
    )
  })
}
