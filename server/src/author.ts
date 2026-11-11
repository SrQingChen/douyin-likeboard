// 作者账号（Sr_青尘）的稳定身份：f46 secUid（账号级，不随昵称/头像/场次/登录态变化）。
// 数字 uid 97905874098 仅作备注；f73 是轮换令牌（实测同 uid 42s 内 158 个不同值），禁止用于身份判定。
// 2026-11-11 从真实直播间 MemberMessage 抓到：nick=Sr_青尘, uid=97905874098, f46=下面这个值。
export const AUTHOR_SEC_UID = 'MS4wLjABAAAAhs9HSVhGCISlyr4RzfOhVsF24VwtOg_SfIx3xGlFVm8';
export const AUTHOR_UID = '97905874098';

export const isAuthorSecUid = (secUid?: string | null): boolean =>
  !!secUid && secUid === AUTHOR_SEC_UID;
