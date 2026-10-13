// FAKE_NOW=<iso> node --import ./tools/fake-clock.mjs t.mjs : the clock starts at FAKE_NOW and runs on (for date-bound tests)
const off = Date.parse(process.env.FAKE_NOW) - Date.now(); const RD = Date; globalThis.Date = class extends RD { constructor(...a) { if (!a.length) super(RD.now() + off); else super(...a); } static now() { return RD.now() + off; } };
