/** @jsxImportSource react */
type Scorer = {
  name: string;
  goals: number;
  own_goals: number;
  yellow_cards: number;
  red_cards: number;
};
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
  divider: '#e5ba5b',
};

function motmName(motm: Motm): string {
  return motm?.name ?? '';
}

// Build the goal badge string. Combines normal goals + own_goals into a
// single label that fits beside the player's name.
function goalLabel(s: Scorer): string | null {
  if (s.goals > 0 && s.own_goals > 0) return `\u26BD\u00D7${s.goals} (OG\u00D7${s.own_goals})`;
  if (s.goals > 0)                    return s.goals === 1 ? '\u26BD' : `\u26BD\u00D7${s.goals}`;
  if (s.own_goals > 0)                return `(OG\u00D7${s.own_goals})`;
  return null;
}

// Card cluster — one square per yellow/red. Twemoji-mapped graphemes
// render as inline images via Satori's graphemeImages.
function cardCluster(s: Scorer): string | null {
  if (s.yellow_cards === 0 && s.red_cards === 0) return null;
  return '\uD83D\uDFE8'.repeat(s.yellow_cards) + '\uD83D\uDFE5'.repeat(s.red_cards);
}

function ScorerRow({ s, side, isMotm }: { s: Scorer; side: 'white' | 'black'; isMotm: boolean }) {
  const goal  = goalLabel(s);
  const cards = cardCluster(s);
  const star  = isMotm ? '\u2B50' : null;

  const color = isMotm ? COLORS.accent : COLORS.text;
  const fontWeight = isMotm ? 700 : 600;

  // Item order — visual reading on white side: [⚽×N] [Name] [🟨🟥] [⭐]
  // Black side uses flexDirection row-reverse so it visually mirrors:
  //   [⭐] [🟨🟥] [Name] [⚽×N]
  const items: { key: string; node: JSX.Element }[] = [];
  if (goal)
    items.push({
      key: 'goal',
      node: <span style={{ display: 'flex', color: isMotm ? COLORS.accent : COLORS.muted }}>{goal}</span>,
    });
  items.push({
    key: 'name',
    node: <span style={{ display: 'flex', fontWeight, color }}>{s.name}</span>,
  });
  if (cards) items.push({ key: 'cards', node: <span style={{ display: 'flex' }}>{cards}</span> });
  if (star)  items.push({ key: 'star',  node: <span style={{ display: 'flex' }}>{star}</span> });

  return (
    <div style={{
      display: 'flex',
      flexDirection: side === 'white' ? 'row' : 'row-reverse',
      alignItems: 'center',
      gap: 12,
      fontSize: 30,
      lineHeight: 1.2,
    }}>
      {items.map((i) => <span key={i.key} style={{ display: 'flex' }}>{i.node}</span>)}
    </div>
  );
}

function ScorerColumn({ list, motm, side }: { list: Scorer[]; motm: string; side: 'white' | 'black' }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: side === 'white' ? 'flex-start' : 'flex-end',
      gap: 12,
      color: COLORS.text,
    }}>
      {list.length === 0
        ? <div style={{ display: 'flex', color: COLORS.footer, fontSize: 28 }}>—</div>
        : list.map((s, idx) => (
            <ScorerRow
              key={idx}
              s={s}
              side={side}
              isMotm={motm !== '' && s.name === motm}
            />
          ))}
    </div>
  );
}

export function MatchCard(props: Props) {
  const motm = motmName(props.motm);
  const title = `${props.season_name} \u2014 Game ${props.match_number} of ${props.total_matches}`;

  return (
    <div style={{
      width: 1080, height: 1080, background: COLORS.bg,
      padding: 64, boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      fontFamily: 'Inter',
    }}>
      <img src={props.crestDataUri} width={200} height={200} style={{ marginBottom: 20 }} />

      {/* Title — single line "Season 11 — Game 32 of 40" */}
      <div style={{
        display: 'flex',
        fontFamily: 'Playfair Display', fontSize: 56, fontWeight: 700,
        color: COLORS.accent, letterSpacing: 1.0, textAlign: 'center',
      }}>
        {title}
      </div>
      {/* Date line */}
      <div style={{
        display: 'flex',
        fontFamily: 'Playfair Display', fontSize: 30,
        color: COLORS.muted, marginTop: 8,
      }}>
        {props.kickoff_label}
      </div>

      {/* Scoreboard */}
      <div style={{
        marginTop: 48, display: 'flex', flexDirection: 'row',
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
            fontSize: 200, fontWeight: 700, lineHeight: 1, color: COLORS.text,
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
            fontSize: 200, fontWeight: 700, lineHeight: 1, color: COLORS.text,
          }}>
            {props.score_black}
          </div>
        </div>
      </div>

      {/* Scorer grid — side-aligned per team */}
      <div style={{
        marginTop: 48, display: 'flex', flexDirection: 'row',
        alignItems: 'flex-start', gap: 64, width: '100%', maxWidth: 880,
      }}>
        <ScorerColumn list={props.white_scorers} motm={motm} side="white" />
        <div style={{ width: 2 }} />
        <ScorerColumn list={props.black_scorers} motm={motm} side="black" />
      </div>
    </div>
  );
}
