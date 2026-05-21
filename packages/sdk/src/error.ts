export class ZeroFansError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ZeroFansError";
    this.status = status;
    this.payload = payload;
  }
}
