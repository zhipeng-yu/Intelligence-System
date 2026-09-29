ALTER TABLE teaching_diagnoses ADD COLUMN images_json TEXT NOT NULL DEFAULT '[]'
  CHECK (length(images_json) <= 6000 AND json_valid(images_json)
    AND json_type(images_json) = 'array' AND json_array_length(images_json) <= 3);
