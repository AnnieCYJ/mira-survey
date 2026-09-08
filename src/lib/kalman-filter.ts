/**
 * 1D Kalman Filter — KalmanJS (wouterbulten/kalmanjs, MIT)
 * https://github.com/wouterbulten/kalmanjs
 * 专为传感器噪声去噪设计，零依赖。
 */
export default class KalmanFilter {
  R: number;
  Q: number;
  A: number;
  C: number;
  B: number;
  cov: number;
  x: number;

  constructor({ R = 1, Q = 1, A = 1, B = 0, C = 1 } = {}) {
    this.R = R; this.Q = Q; this.A = A; this.C = C; this.B = B;
    this.cov = NaN; this.x = NaN;
  }

  filter(z: number, u = 0): number {
    if (Number.isNaN(this.x)) {
      this.x = (1 / this.C) * z;
      this.cov = (1 / this.C) * this.Q * (1 / this.C);
    } else {
      const predX = this.predict(u);
      const predCov = this.uncertainty();
      const K = predCov * this.C * (1 / (this.C * predCov * this.C + this.Q));
      this.x = predX + K * (z - this.C * predX);
      this.cov = predCov - K * this.C * predCov;
    }
    return this.x;
  }

  predict(u = 0): number { return this.A * this.x + this.B * u; }
  uncertainty(): number { return this.A * this.cov * this.A + this.R; }
  lastMeasurement(): number { return this.x; }
}
