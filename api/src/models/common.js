import mongoose from 'mongoose';

export const { Schema } = mongoose;
export const { ObjectId, Mixed } = Schema.Types;

// created_at / updated_at on every document; our own `version` field is the optimistic lock, so Mongoose's __v is off.
// minimize: false keeps empty `fields: {}` bags instead of dropping them.
export const baseOptions = (collection, extra = {}) => ({
  collection,
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
  minimize: false,
  ...extra,
});

export const tenantRef = { type: ObjectId, ref: 'Tenant', required: true, index: false };

// A unique index that only applies when the value is present (Instagram handle, AWB, transaction ref, ...)
export const whenString = (field) => ({ partialFilterExpression: { [field]: { $type: 'string' } } });

// The actor block copied onto every event, so reports stay right after people change teams (PLAN §8.2)
export const ActorSchema = new Schema({
  user_id: { type: ObjectId, ref: 'User' },
  name: String,
  team_id: { type: ObjectId, ref: 'Team' },
  team_name: String,
  role: String,
}, { _id: false });

export const ChangeSchema = new Schema({
  field: { type: String, required: true },
  scope: String,
  old: Mixed,
  new: Mixed,
}, { _id: false });
