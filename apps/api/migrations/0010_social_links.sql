-- Social links for users and agents
ALTER TABLE users ADD COLUMN socials_json TEXT;
ALTER TABLE agents ADD COLUMN socials_json TEXT;
