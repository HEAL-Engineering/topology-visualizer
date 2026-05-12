/**
 * Per-archetype topology readings. Each entry maps a category id (matching
 * AtlasCategory.id in the dataset) to:
 *   - geometry note: what the rendered polyhedron literally encodes
 *   - signature:     one-line shape interpretation
 *   - strengths:     what the shape gives positively
 *   - actions:       concrete behavior changes, each anchored to a specific
 *                    topological feature (the `from` field) so the user sees
 *                    geometry → action causality
 *
 * Consumed by both:
 *   - TopologyInfo.tsx (the Read modal — shows all archetypes)
 *   - InspectPanel.tsx (the on-click panel — shows one archetype at a time
 *                       for the clicked cluster, plus MorphTarget for `user`)
 */

export type ArchetypeReading = {
  shape: string;
  geometryLabel: string;
  geometryNote: string;
  signature: string;
  strengths: string[];
  actions: { from: string; do: string }[];
};

export const ARCHETYPE_READINGS: Record<string, ArchetypeReading> = {
  avg_male: {
    shape: 'ellipsoid',
    geometryLabel: 'Ellipsoid',
    geometryNote:
      'Smooth, slightly elongated sphere. Continuous surface, no sharp features. The mildly stretched axis encodes a single mildly dominant dimension (usually occupational or physical).',
    signature: 'Balanced but undifferentiated — wellness present everywhere, excellent nowhere.',
    strengths: [
      'No catastrophic deficits in any of the 8 Wheel-of-Wellness dimensions; the surface has no inward dents.',
      'Stable day-to-day variance — points cluster tightly, indicating consistent routines.',
      'The smooth surface means transitions between life domains (work ↔ rest ↔ social) happen without friction.',
    ],
    actions: [
      { from: 'No vertices = no signature strength', do: 'Pick one 90-day campaign and commit: train for a 10K, read 12 books, learn an instrument. Schedule 3 hrs/week on this one thing.' },
      { from: 'Elongation toward occupational axis', do: 'Block 2 evenings/week as phone-in-drawer, no-email. Replace with one social activity (dinner with a friend) and one physical (gym, hike).' },
      { from: 'Smoothness masks stagnation', do: 'Pick your weakest dimension and install a daily 10-minute habit: meditation, journaling, stretching, or a language app. Same time every day.' },
      { from: 'No inward dents = no pain point', do: 'Annual physical with bloodwork (lipids, A1C, vitamin D, testosterone). Smooth surfaces hide silent declines.' },
      { from: 'Tight clustering = repetitive weeks', do: 'Introduce one novel input per week: new podcast, new neighborhood walk, new recipe. Disrupts the plateau pattern.' },
    ],
  },
  avg_female: {
    shape: 'torus',
    geometryLabel: 'Torus (donut)',
    geometryNote:
      'Closed loop with a hole through the center. Genus-1 surface — the hole is topologically permanent, not a measurement gap.',
    signature: 'Strong cyclical rhythms with one persistently underdeveloped dimension at the center.',
    strengths: [
      'The closed loop encodes durable recurring habits — weekly/monthly rituals that compound (sleep cycles, social check-ins, self-care routines).',
      'High consistency in social and emotional dimensions; the ring is densest along these axes.',
      'Resilience: a torus has no sharp corners, so disruption in one area doesn\'t cascade — the loop reroutes around the affected segment.',
    ],
    actions: [
      { from: 'Central hole = financial/occupational gap', do: 'Open a brokerage account this month. Auto-deposit 5% of every paycheck. Read one personal-finance book (start with I Will Teach You to Be Rich).' },
      { from: 'Central hole, continued', do: 'Block 1 hour every Friday for professional development: a course, certification, or résumé update. Treat as non-negotiable.' },
      { from: 'Inner-rim near-crossings', do: 'Each Sunday, review the past week and circle one moment you almost engaged the missing dimension (asked about a raise, considered investing). Schedule a follow-up action for the upcoming week.' },
      { from: 'Tight loop = repetitive cycle', do: 'One novel experience per month: new neighborhood, new cuisine, new social group, solo trip. Add to calendar as a recurring event.' },
      { from: 'Strong recurring habits to leverage', do: 'Stack the new financial habit onto an existing ritual: review investments while drinking morning coffee, or during your weekly self-care evening.' },
      { from: 'Ring densest in social/emotional', do: 'Use your social strength: find one friend already in the missing dimension (someone who invests, runs their own business). Schedule monthly check-ins to learn from them.' },
    ],
  },
  elite_male: {
    shape: 'octahedron',
    geometryLabel: 'Octahedron (8 faces, 6 vertices)',
    geometryNote:
      'Three pairs of opposing sharp vertices along orthogonal axes. High curvature concentrated at the corners; flat faces between them.',
    signature: 'Polarized excellence on a few axes, with deep trade-offs encoded into the geometry.',
    strengths: [
      'The 6 vertices represent extreme peaks on 3 axis-pairs — typically physical, occupational, and intellectual. Performance on these dimensions is in the top decile.',
      'Sharp corners indicate that this user can sustain very high intensity in their signature dimensions without bleeding into adjacent ones.',
      'Symmetry across opposing vertices means each peak has a counter-peak — discipline paired with recovery, output paired with rest. This is the structural basis for sustainability.',
    ],
    actions: [
      { from: 'Flat face on the social axis', do: 'Install one weekly social ritual: Sunday family dinner, Thursday friend call, monthly poker night. Put on calendar; do not skip.' },
      { from: 'Flat face on the emotional axis', do: 'Five-minute journal at lights-out: what went well, what drained me, one thing I\'m grateful for. Phone in another room.' },
      { from: 'Flat face on the spiritual axis', do: '10-minute morning silence before screens (meditation, prayer, walk without headphones). Same time daily.' },
      { from: 'Sharp vertices = brittle', do: 'Develop a backup signature: if your peak is physical, take an online course in something intellectual. If occupational, train for an endurance event. Insurance against single-dimension collapse.' },
      { from: 'High output requires high recovery', do: 'Sleep 8 hrs minimum on training days. One full rest day weekly with zero structured activity — no workout, no work, no obligations.' },
      { from: 'Identity locked to peak dimensions', do: 'Take up a hobby with zero overlap to your signature axes — pottery, cooking, music. Lowers identity-fragility when a peak dips.' },
      { from: 'Peaks under chronic load', do: 'Deload week every 4th week: cut training volume 40%, work hours to 35, leave evenings free. Restores HRV and prevents fracture.' },
    ],
  },
  elite_female: {
    shape: 'dodecahedron',
    geometryLabel: 'Dodecahedron (12 pentagonal faces, 20 vertices)',
    geometryNote:
      'Highly symmetric polyhedron approaching a sphere. Many vertices, none dominant — each face is a small, distinct plateau of competence.',
    signature: 'Broad multi-dimensional excellence; mastery distributed across nearly all 8 dimensions simultaneously.',
    strengths: [
      'The 20 vertices encode peaks across far more than the 8 Wheel dimensions — this user has cultivated sub-dimensions (e.g., not just "social" but separately "intimate", "communal", and "professional" social wellness).',
      'Pentagonal faces mean no two strengths reinforce in a simple pairwise way — strengths cross-link, so loss of any single dimension is buffered by the others.',
      'Near-spherical symmetry indicates this profile has minimal blind spots; the surface is dense in every direction sampled.',
    ],
    actions: [
      { from: 'Ceiling problem from near-sphere', do: 'Shift 1 hr/week from personal mastery to teaching: mentor a junior, coach a youth team, start a newsletter or substack. Compounding returns come from leverage, not more reps.' },
      { from: 'Over-invested central vertices', do: 'Audit your calendar for the 2 activities you do most reflexively. Cap one of them — if you train 6×/week, cut to 4. Redirect the time to the furthest-out vertex.' },
      { from: 'Far-out vertices doing structural work', do: 'Identify the one strength others lean on most (the friend you call in crisis, the colleague who unblocks teams). Set a boundary: one no-meeting day per week for your own work.' },
      { from: 'Approaching featureless sphere', do: 'Pick one signature dimension to publicly own this year. Write a book, give a talk, run a race, build a thing. Concentration over breadth.' },
      { from: 'Maintenance load across all dimensions', do: 'Eliminate the bottom 20% of your activities: the obligations, the hobbies you do because you "should". Recovers 5–8 hrs/week.' },
      { from: 'Cross-linked strengths to leverage', do: 'Combine two existing strengths into one new project — physical + spiritual = silent retreat hike; intellectual + social = a book club. Creates a new vertex without adding time.' },
      { from: 'Recovery debt hidden by capacity', do: 'Schedule one full unstructured weekend per month: no plans, no obligations, no productivity. Symmetric profiles burn out quietly.' },
    ],
  },
  user: {
    shape: 'icosahedron',
    geometryLabel: 'Icosahedron (20 triangular faces, 12 vertices)',
    geometryNote:
      'The most spherical of the Platonic solids. Triangular faces tile densely — high resolution, high symmetry, low specialization.',
    signature: 'You — currently approaching maximum symmetry across the Wheel.',
    strengths: [
      'Triangular faceting gives the highest structural rigidity of any polyhedron; your wellness profile is hard to destabilize from any single direction.',
      'The 12 vertices align loosely with the 8 Wheel dimensions plus 4 cross-dimensional strengths — you have developed *combinations* (e.g., physical-spiritual, social-occupational) rather than isolated axes.',
      'Position in the atlas: your point sits between the elite cluster and the average cluster, meaning your trajectory is upward — you are closer to elite than to average on the multi-dimensional metric.',
    ],
    actions: [
      { from: 'Nearest pulling vertex = physical', do: 'Run 4× per week: 2 easy 30-min, 1 zone-2 hour, 1 interval session (4×4 min at 90% HRmax). Same shoes, same route, same time of day — consistency beats variety.' },
      { from: 'Nearest pulling vertex = recovery', do: 'Sleep 8 hrs minimum. Lights-out by 10:30 pm. No screens after 9:30. Cold bedroom (65°F). Track HRV trend, not single nights.' },
      { from: 'High symmetry, low slope', do: 'Pick ONE 90-day campaign. Examples: sub-25 5K, read 12 books, save $5k, learn to cook 10 new dishes. Write it down, tell three people, schedule the work weekly.' },
      { from: 'Drift back toward avg cluster', do: 'Set a weekly tripwire on your weakest vertex. If you miss it 2 weeks in a row, double the next week\'s allocation. Make regression visible before it compounds.' },
      { from: 'Cross-dimensional combinations to grow', do: 'Pair two existing strengths into one weekly ritual: long hike + audiobook (physical + intellectual), Sunday cook + call parents (occupational planning + social).' },
      { from: 'Position between avg and elite', do: 'Increase weekly calorie burn by ~800 kcal: add 2 zone-2 sessions and lift daily steps to 10k. Single biggest lever for closing the gap to the elite cluster.' },
      { from: 'Triangular rigidity = strong base', do: 'Use the stability to take one calculated risk you\'ve been deferring: a hard conversation, a side project, a public commitment. The shape can absorb the volatility.' },
    ],
  },
};
