// 今夜の一杯：五つの答えから一杯を決める（設計書 §5）
// cast は data.casts.nagi などの中身、answers は選択肢番号（0〜2）を五つ並べた配列。

export function pick(cast, answers) {
  const qs = cast.questions;
  if (!Array.isArray(answers) || answers.length !== qs.length) {
    throw new RangeError(`answers must have ${qs.length} items`);
  }
  let a = 0;
  let b = 0;
  answers.forEach((n, i) => {
    const choice = Number.isInteger(n) ? qs[i].choices[n] : undefined;
    if (!choice) throw new RangeError(`answer ${i + 1} is out of range: ${n}`);
    if (qs[i].axis === 'A') a += choice.score;
    else b += choice.score;
  });
  const taste = a <= -1 ? 'soft' : a >= 1 ? 'bright' : 'usual';
  const mood = b > 0 ? 'talk' : b < 0 ? 'quiet' : cast.tie;
  return cast.drinks.find(d => d.taste === taste && d.mood === mood);
}

// アプリ内ブラウザ（X・Instagram・Facebook・LINE・TikTok）か。
// ここでは <a download> が黙って無視されることがあるので、保存は絵を大きく出す道へ回す。
const IN_APP = /Twitter|Instagram|FBAN|FBAV|Line\/|TikTok|BytedanceWebview/;
export function isInAppBrowser(ua) {
  return typeof ua === 'string' && IN_APP.test(ua);
}
