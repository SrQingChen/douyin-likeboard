export interface BoardRow {
  secUid: string; nick: string; avatar: string | null; badge: string | null;
  likes: number; speed: number; capped: boolean; rank: number;
  storeTotalLikes: number; storeChampion: number; storeRunner: number; storeThird: number;
}
export interface Snapshot {
  t: 'board'; at: number;
  room: {
    webRid: string; anchor: string; online: number; roomTotal: number;
    sessionLikes: number; ratePerMin: number; peakRate: number; coverage: number;
  };
  round: { idx: number; startedAt: number; endsAt: number | null; basis: 'round' | 'session' };
  capture: string;
  podium: BoardRow[]; list: BoardRow[];
  stats: { likers: number; global: Record<string, number> };
  records: {
    roundRecord: { v: number; secUid: string; nick: string; at: number } | null;
    streakRecord: { v: number; secUid: string; nick?: string } | null;
    sessionMost: { secUid: string; likes: number; nick: string } | null;
    fastest: { secUid: string; speed: number; nick: string } | null;
    holders?: { champion: { nick: string; v: number } | null; runner: { nick: string; v: number } | null; third: { nick: string; v: number } | null };
    global: { users: number; totalLikes: number; rounds: number; sessions: number };
  };
}
export interface SettleToast {
  roundIdx: number;
  top: { rank: number; secUid: string; nick: string; likes: number }[];
  ceremony: 'champion' | 'record' | 'normal';
  recordBroken: string | null;
  settleType: string;
}
