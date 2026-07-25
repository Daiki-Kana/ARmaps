/**
 * ジオロケーション・地理座標計算ユーティリティ
 *
 * 修正ポイント:
 *  - lerpAngle のロジックを修正 (0°/360° 境界での安定性向上)
 */

// 地球の半径 (メートル)
const EARTH_RADIUS = 6371000;

/**
 * 角度をラジアンに変換
 */
function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * ラジアンを角度に変換
 */
function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}

/**
 * 2地点間の距離 (メートル) を計算する (Haversine Formula)
 */
export function calculateDistance(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const rLat1 = toRadians(lat1);
  const rLat2 = toRadians(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(rLat1) * Math.cos(rLat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS * c;
}

/**
 * 地点1(現在地)から地点2(目的地)への方位角 Bearing (0° = 北, 90° = 東, 180° = 南, 270° = 西) を計算
 */
export function calculateBearing(lat1, lon1, lat2, lon2) {
  const rLat1 = toRadians(lat1);
  const rLat2 = toRadians(lat2);
  const dLon = toRadians(lon2 - lon1);

  const y = Math.sin(dLon) * Math.cos(rLat2);
  const x =
    Math.cos(rLat1) * Math.sin(rLat2) -
    Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLon);

  let brng = toDegrees(Math.atan2(y, x));
  return (brng + 360) % 360; // 0〜360度に正規化
}

/**
 * 距離表示用文字列の整形 (例: 85m, 1.2km)
 */
export function formatDistance(meters) {
  if (meters == null || isNaN(meters)) return '測位中...';
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}

/**
 * 最短経路での角度Lerp (線形補間)
 * 359度 → 1度 の切り替わりで遠回り回転するのを防ぎます
 *
 * 0°/360° 境界を正しく処理するために、差分を -180 ~ 180 に正規化してから補間する
 */
export function lerpAngle(current, target, alpha = 0.15) {
  // 差分を -180 ~ +180 に正規化
  let diff = target - current;
  // modを-180 ~ +180範囲に収める
  diff = ((diff % 360) + 540) % 360 - 180;

  let result = current + diff * alpha;
  // 結果を 0 ~ 360 に正規化
  return ((result % 360) + 360) % 360;
}
