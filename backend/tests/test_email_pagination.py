"""
Unit Tests for Email Recipients Pagination
Tests pagination functionality
"""

import unittest
import sqlite3
import os
import tempfile
import sys

# Add parent directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from core.email_db import get_all_recipients, add_recipient, init_email_tables


class TestEmailPagination(unittest.TestCase):
    """Test Email Recipients Pagination"""

    def setUp(self):
        """Set up test fixtures"""
        # Create temporary database
        self.temp_db = tempfile.NamedTemporaryFile(delete=False, suffix='.db')
        self.temp_db.close()

        # Patch DB_PATH
        import core.email_db
        self.original_db_path = core.email_db.DB_PATH
        core.email_db.DB_PATH = self.temp_db.name

        # Initialize tables
        init_email_tables()

        # Clear default recipients
        conn = sqlite3.connect(self.temp_db.name)
        conn.execute("DELETE FROM email_recipients")
        conn.commit()
        conn.close()

    def tearDown(self):
        """Clean up test fixtures"""
        import core.email_db
        core.email_db.DB_PATH = self.original_db_path
        os.unlink(self.temp_db.name)

    def test_pagination_basic(self):
        """Test #7: Basic pagination works"""
        # Add 25 recipients
        for i in range(25):
            add_recipient(
                email=f'user{i}@example.com',
                display_name=f'User {i}',
                created_by='test'
            )

        # Get first page (10 items)
        result = get_all_recipients(limit=10, offset=0)

        self.assertEqual(len(result['items']), 10)
        self.assertEqual(result['total'], 25)
        self.assertEqual(result['limit'], 10)
        self.assertEqual(result['offset'], 0)
        self.assertTrue(result['has_more'])

    def test_pagination_second_page(self):
        """Test #7: Second page returns correct items"""
        # Add 25 recipients
        for i in range(25):
            add_recipient(
                email=f'user{i}@example.com',
                display_name=f'User {i}',
                created_by='test'
            )

        # Get second page
        result = get_all_recipients(limit=10, offset=10)

        self.assertEqual(len(result['items']), 10)
        self.assertEqual(result['total'], 25)
        self.assertEqual(result['offset'], 10)
        self.assertTrue(result['has_more'])

        # Verify different items
        first_email = result['items'][0]['email']
        self.assertEqual(first_email, 'user10@example.com')

    def test_pagination_last_page(self):
        """Test #7: Last page returns remaining items"""
        # Add 25 recipients
        for i in range(25):
            add_recipient(
                email=f'user{i}@example.com',
                display_name=f'User {i}',
                created_by='test'
            )

        # Get last page
        result = get_all_recipients(limit=10, offset=20)

        self.assertEqual(len(result['items']), 5)  # Only 5 remaining
        self.assertEqual(result['total'], 25)
        self.assertEqual(result['offset'], 20)
        self.assertFalse(result['has_more'])  # No more items

    def test_pagination_empty_result(self):
        """Test #7: Empty result when offset exceeds total"""
        # Add 5 recipients
        for i in range(5):
            add_recipient(
                email=f'user{i}@example.com',
                display_name=f'User {i}',
                created_by='test'
            )

        # Request page beyond available data
        result = get_all_recipients(limit=10, offset=10)

        self.assertEqual(len(result['items']), 0)
        self.assertEqual(result['total'], 5)
        self.assertFalse(result['has_more'])

    def test_pagination_custom_limit(self):
        """Test #7: Custom limit works correctly"""
        # Add 50 recipients
        for i in range(50):
            add_recipient(
                email=f'user{i}@example.com',
                display_name=f'User {i}',
                created_by='test'
            )

        # Get first 25
        result = get_all_recipients(limit=25, offset=0)

        self.assertEqual(len(result['items']), 25)
        self.assertEqual(result['total'], 50)
        self.assertTrue(result['has_more'])

    def test_pagination_default_values(self):
        """Test #7: Default limit and offset work"""
        # Add 150 recipients
        for i in range(150):
            add_recipient(
                email=f'user{i}@example.com',
                display_name=f'User {i}',
                created_by='test'
            )

        # Use defaults (limit=100, offset=0)
        result = get_all_recipients()

        self.assertEqual(len(result['items']), 100)  # Default limit
        self.assertEqual(result['total'], 150)
        self.assertEqual(result['offset'], 0)
        self.assertTrue(result['has_more'])


if __name__ == '__main__':
    unittest.main()
