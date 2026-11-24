-- db/migrations/009_county_record_status.sql
-- New contacts.address_status value 'county_record': the mailing address came from county
-- tax-parcel records (owner mailing address), via scripts/county_parcel_match.py.
-- Like 'verified', imports do not overwrite it -- unless a newer closed purchase arrives.
-- Idempotent. Apply with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/009_county_record_status.sql

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_address_status_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_address_status_check
  CHECK (address_status IN ('buyer_property', 'contact_file', 'needs_lookup', 'verified',
                            'county_record', 'undeliverable'));
