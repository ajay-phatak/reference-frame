// Metric → notes-search-terms table, ported from
// wcs-analyze-skill/references/metric_hub_map.md. Turns a gap-analysis row
// label (or a SUMMARY FLAGS line) into the concept/keyword terms to grep the
// dancer's own lesson notes for, so the coach can be handed the dancer's prior
// instruction for closing that gap. Read-only lookup — no Obsidian, no MCP.
//
// Order matters: entries are tested top-to-bottom and the FIRST whose `match`
// substring appears in the (lowercased) row label wins, so the more specific
// rows (standing-leg vs generic knee flex; stretch-after-post vs distance
// variance) come before the general ones.

export interface HubEntry {
  // Lowercased substrings to test against the gap-row label / flag line.
  match: string[]
  // Concept/keyword terms to search the notes for.
  terms: string[]
}

export const HUBMAP: HubEntry[] = [
  // --- Articulation quality (specific rows before generic knee flex) ---
  {
    match: ['standing-leg', 'standing leg', 'standing sink'],
    terms: [
      'sit into the standing leg',
      'compression into the floor',
      'get low',
      'load',
      'drive from the floor',
      'sink'
    ]
  },
  {
    match: ['free-leg prep', 'free leg prep', 'prep knee', 'prep hip', 'free-leg knee flex'],
    terms: [
      'prep the foot',
      'gather',
      'pick up the foot',
      'knee bend',
      'leg swing',
      'collect under you'
    ]
  },
  {
    match: ['knee-hip coordination', 'knee hip coordination', 'knee↔hip', 'knee-hip coord'],
    terms: ['hip hinge', 'knee and hip together', 'leg line', "don't pike", 'stacked']
  },
  {
    match: ['bend smoothness'],
    terms: ['smooth', 'continuous', 'roll through the foot', 'one motion', 'no hitch']
  },
  {
    match: [
      'straighten recovery',
      'prep→arrival',
      'prep-arrival',
      'arrival sequencing',
      'sequencing'
    ],
    terms: [
      'straighten the leg',
      'push the floor away',
      'rise',
      'settle then send',
      'weight arrival',
      'drive from the floor'
    ]
  },
  {
    match: ['knee flex', 'knee flexion'],
    terms: ['knee bend', 'compression', 'sit', 'lower', 'leg spring']
  },
  // --- Leg action / footwork ---
  {
    match: ['1-foot balance', 'one-foot balance', 'balance %'],
    terms: ['weight transfer', 'commit', 'balance', 'ball of foot', 'foot pressure']
  },
  {
    match: ['triple step'],
    terms: ['triple step', 'footwork', 'anchor step']
  },
  {
    match: [
      'weight-only traveling',
      'articulated traveling',
      'traveling',
      'steps/min',
      'weight-only'
    ],
    terms: ['stillness', 'settle', 'anchor', 'break less', 'economy', 'hold', 'delay']
  },
  {
    match: ['rise/fall', 'rise fall'],
    terms: [
      'rise and fall',
      'bounce',
      'level change',
      'compression into floor',
      'knee bend',
      'body flight'
    ]
  },
  // --- Body action / structure ---
  {
    match: [
      'hip→shoulder',
      'hip-shoulder',
      'shoulder→head',
      'fluidity',
      'dissociation',
      'block body'
    ],
    terms: ['sequential', 'dissociation', 'layering', 'body tone', 'joint twist']
  },
  {
    match: ['pitch', 'sway'],
    terms: ['pitch', 'lean', 'sway', 'shaping', 'body flight', 'stretch the side']
  },
  {
    match: ['posture', 'poise', 'frame', 'body tone', 'carriage'],
    terms: [
      'posture',
      'poise',
      'frame',
      'body tone',
      'stay tall',
      'head position',
      'shoulders down',
      'carriage'
    ]
  },
  // --- Travel & posts (spotlight vs slot vs stretch) ---
  {
    match: ['floor travel'],
    terms: ['use the floor', 'travel the room', 'spotlight', 'cover ground', 'journey', 'stage']
  },
  {
    match: ['slotted movement', 'slot travel', 'down the slot'],
    terms: [
      'travel the slot',
      'down the slot',
      'send her down',
      'post and travel',
      'cover the slot',
      'go somewhere'
    ]
  },
  {
    match: ['stretch range', 'compression range', 'stretch-leading', 'compression-leading'],
    terms: [
      'stretch out of the anchor',
      'slingshot',
      'leverage',
      'send',
      'expand off the post',
      'time under tension'
    ]
  },
  {
    match: ['posts detected', 'posts', 'post stretch'],
    terms: [
      'anchor',
      'post',
      'settle',
      'directional intent',
      'stop with intent',
      'hold the connection'
    ]
  },
  // --- Partnering / connection ---
  {
    match: ['distance variance', 'partner distance'],
    terms: [
      'stretch',
      'compression',
      'leverage',
      'extension',
      'slingshot',
      'elastic',
      'time under tension'
    ]
  },
  {
    match: ['counter-balance', 'counterbalance'],
    terms: ['counterbalance', 'leverage', 'lean away', 'shared weight', 'resistance']
  },
  {
    match: ['connection', 'contact point', 'connection noise'],
    terms: [
      'quiet the connection',
      'hands down and out',
      "don't move the elbow",
      'spring',
      'pool floaties'
    ]
  },
  // --- Musicality ---
  {
    match: ['texture match'],
    terms: [
      'match the texture',
      'bouncy vs smooth',
      'quality of movement',
      'what the music calls for',
      'groove vs glide'
    ]
  },
  {
    match: ['bounce match'],
    terms: ['bounce to the beat', 'pulse', 'groove', 'match the texture']
  },
  {
    match: ['music-movement', 'music movement tracking'],
    terms: ['dynamics', 'energy', 'accent the music', 'texture', 'hit', 'build']
  },
  {
    match: ['accent coverage', 'partnership coverage', 'framing'],
    terms: [
      'hit',
      'accent',
      'set up the follow',
      'frame',
      'give her the moment',
      'lead for musicality'
    ]
  },
  {
    match: ['accent response', 'accent hit intensity', 'hit intensity', 'accent'],
    terms: [
      'hit',
      'accent',
      'break',
      'stab',
      'mark the music',
      'punctuate',
      'catch the hit',
      'big moment'
    ]
  },
  {
    match: ['on-beat', 'timing consistency'],
    terms: ['timing', 'on the beat', 'accent', 'count', 'land on time']
  },
  {
    match: ['syncopation'],
    terms: ['syncopation', '& counts', 'rhythm play', 'hold and go']
  },
  {
    match: ['6-count', '8-count', 'pattern', 'fingerprint'],
    terms: ['pattern selection', 'variety', 'song interpretation', 'vocabulary']
  },
  {
    match: ['arm styling', 'shoulder→wrist', 'body-arm', 'wrist'],
    terms: ['free arm', 'styling', 'arm follows body', 'wave', 'expression']
  },
  // --- Catch-all smoothness (after the specific bend-smoothness row) ---
  {
    match: ['motion smoothness', 'smoothness', 'choppy'],
    terms: ['smooth', 'continuous', 'fluid', 'flow', 'swing', 'connect movements']
  }
]

/** Search terms for a gap-row label / flag line, or [] if unmapped. */
export function termsForGap(label: string): string[] {
  const l = label.toLowerCase()
  for (const entry of HUBMAP) {
    if (entry.match.some((m) => l.includes(m))) return entry.terms
  }
  return []
}
