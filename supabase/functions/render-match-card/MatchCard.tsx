/** @jsxImportSource react */
type Scorer = { name: string; goals: number; own_goals: number };
type Motm = { name: string; is_guest: boolean } | null;

type Props = {
  season_name: string;
  match_number: number;
  total_matches: number;
  kickoff_label: string;
  score_white: number;
  score_black: number;
  white_scorers: Scorer[];
  black_scorers: Scorer[];
  motm: Motm;
  crestDataUri: string;
};

const COLORS = {
  bg:     '#0e1826',
  text:   '#f2ead6',
  accent: '#e5ba5b',
  muted:  '#c9b88a',
  footer: '#6e6450',
};

function ScorerColumn({ list }: { list: Scorer[] }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap: 8,
      fontSize: 28, color: COLORS.text,
    }}>
      {list.length === 0
        ? <div style={{ display: 'flex', color: COLORS.footer }}>—</div>
        : list.map((s, idx) => (
            <div key={idx} style={{ display: 'flex' }}>{scorerLine(s)}</div>
          ))}
    </div>
  );
}

function scorerLine(s: Scorer): string {
  // A row appears once per (player, team). Show "Name × N" for normal goals,
  // "Name (OG)" for an own-goal-only row, or "Name × N (OG)" if the same
  // player has both (rare but possible). Keep it on a single line.
  const segments: string[] = [];
  if (s.goals > 0) segments.push(s.goals === 1 ? s.name : `${s.name} × ${s.goals}`);
  if (s.own_goals > 0) {
    if (s.goals > 0) segments.push('(OG)');
    else             segments.push(`${s.name} (OG)`);
  }
  return segments.join(' ');
}

export function MatchCard(props: Props) {
  const meta = `Match ${props.match_number} of ${props.total_matches} · ${props.kickoff_label}`;

  return (
    <div style={{
      width: 1080, height: 1080, background: COLORS.bg,
      padding: 64, boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      fontFamily: 'Inter',
    }}>
      <img src={props.crestDataUri} width={120} height={120} style={{ marginBottom: 12 }} />

      {/* Serif title + meta — explicit display:flex on every text-bearing
       * div per Satori v0.10 enforcement. */}
      <div style={{
        display: 'flex',
        fontFamily: 'Playfair Display', fontSize: 64, fontWeight: 700,
        color: COLORS.accent, letterSpacing: 1.3,
      }}>
        {props.season_name}
      </div>
      <div style={{
        display: 'flex',
        fontFamily: 'Playfair Display', fontSize: 28,
        color: COLORS.muted, marginTop: 6,
      }}>
        {meta}
      </div>

      {/* Scoreboard — split with vertical gold-gradient divider.
       * Children rendered as explicit siblings; Satori's React renderer
       * can't unwrap <></> Fragments inside a .map (silently rewraps them
       * as a <div> with no `display`, which then trips Satori v0.10's
       * "explicit display: flex / none" check). S063 fix. */}
      <div style={{
        marginTop: 56, display: 'flex', flexDirection: 'row',
        alignItems: 'center', justifyContent: 'center',
        gap: 64, width: '100%', maxWidth: 880,
      }}>
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 12,
        }}>
          <div style={{
            display: 'flex',
            fontSize: 28, fontWeight: 600, textTransform: 'uppercase',
            letterSpacing: 6.7, color: COLORS.text,
          }}>WHITE</div>
          <div style={{
            display: 'flex',
            fontSize: 200, fontWeight: 600, lineHeight: 1, color: COLORS.text,
          }}>
            {props.score_white}
          </div>
        </div>
        <div style={{
          width: 2, height: 220,
          background: 'linear-gradient(to bottom, transparent, #e5ba5b, transparent)',
        }} />
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 12,
        }}>
          <div style={{
            display: 'flex',
            fontSize: 28, fontWeight: 600, textTransform: 'uppercase',
            letterSpacing: 6.7, color: COLORS.text,
          }}>BLACK</div>
          <div style={{
            display: 'flex',
            fontSize: 200, fontWeight: 600, lineHeight: 1, color: COLORS.text,
          }}>
            {props.score_black}
          </div>
        </div>
      </div>

      {/* Scorer grid — same column rhythm as the scoreboard */}
      <div style={{
        marginTop: 48, display: 'flex', flexDirection: 'row',
        alignItems: 'flex-start', gap: 64, width: '100%', maxWidth: 880,
      }}>
        <ScorerColumn list={props.white_scorers} />
        <div style={{ width: 2 }} />
        <ScorerColumn list={props.black_scorers} />
      </div>

      {/* MOTM gold pill — omitted entirely if no MOTM. No footer. */}
      {props.motm && (
        <div style={{
          marginTop: 'auto', alignSelf: 'center',
          padding: '12px 28px', border: `1px solid ${COLORS.accent}`, borderRadius: 999,
          fontSize: 24, fontWeight: 600, color: COLORS.accent,
          textTransform: 'uppercase', letterSpacing: 3.8,
          display: 'flex',
        }}>
          ✨ MOTM · {props.motm.name}
        </div>
      )}
    </div>
  );
}
