import json
from pathlib import Path
import tempfile
import unittest

from bulk_ocr_schedule import has_current_draft


class DraftResumeTests(unittest.TestCase):
    def test_resume_requires_current_group_and_source(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "group.json"
            self.assertFalse(has_current_draft(target, "old", "group"))
            target.write_text(json.dumps({"purpose": "ocr-draft-not-reviewed",
                "groupNrec": "group", "sourcePdfSha256": "old", "schedule": [{}]}), encoding="utf-8")
            self.assertTrue(has_current_draft(target, "old", "group"))
            self.assertFalse(has_current_draft(target, "new", "group"))
            self.assertFalse(has_current_draft(target, "old", "other"))
            target.write_text("broken", encoding="utf-8")
            self.assertFalse(has_current_draft(target, "old", "group"))


if __name__ == "__main__":
    unittest.main()
