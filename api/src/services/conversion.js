// Lead -> Order at Won (spec §2, PLAN §11.1). Built in M5.
import { HttpError } from '../lib/errors.js';

export async function winLead() {
  throw new HttpError(501, 'Converting a Won lead into an order is not built yet');
}
