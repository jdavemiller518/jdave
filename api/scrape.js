require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cheerio = require('cheerio');

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function validateSchema() {
  try {
    // First check if table exists
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .limit(1); // Get one record to check schema

    if (error) {
      if (error.code === '42P01') { // Table doesn't exist
        throw new Error(`Table 'documents' doesn't exist. Run this SQL:
          CREATE TABLE documents (
            id SERIAL PRIMARY KEY,
            content TEXT NOT NULL,
            embedding vector(384) NOT NULL,
            url TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
          );`);
      }
      throw error;
    }

    // If table is empty but exists, check columns via empty insert
    if (!data || data.length === 0) {
      const testData = {
        content: 'test',
        embedding: Array(384).fill(0),
        url: 'http://test.com'
      };
      const { error: testError } = await supabase
        .from('documents')
        .insert(testData)
        .select();
      
      if (testError) {
        const missingCol = testError.message.match(/column "(.*?)"/);
        if (missingCol) {
          throw new Error(`Missing column: ${missingCol[1]}. Run:
            ALTER TABLE documents ADD COLUMN ${missingCol[1]} ${missingCol[1] === 'embedding' ? 'vector(384)' : 'TEXT'};`);
        }
        throw testError;
      }
      // Clean up test data
      await supabase.from('documents').delete().eq('url', 'http://test.com');
      return;
    }

    // Verify columns exist in returned data
    const requiredColumns = ['content', 'embedding', 'url'];
    const missingColumns = requiredColumns.filter(col => !(col in data[0]));
    if (missingColumns.length > 0) {
      throw new Error(`Missing columns: ${missingColumns.join(', ')}`);
    }

  } catch (error) {
    console.error('Schema validation failed:', error.message);
    throw error;
  }
}

async function runScraper() {
  try {
    await validateSchema();
    
    const targetUrl = 'https://example.com'; // ← CHANGE THIS
    console.log(`🌐 Fetching ${targetUrl}...`);
    const { data } = await axios.get(targetUrl);
    const $ = cheerio.load(data);
    const text = $('body').text()
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 2000);

    console.log(`📝 Extracted text (${text.length} chars)`);

    const { error } = await supabase
      .from('documents')
      .insert({
        content: text,
        embedding: Array(384).fill(0.1),
        url: targetUrl
      });

    if (error) throw error;
    console.log('✅ Successfully stored in Supabase!');
    
  } catch (error) {
    console.error('❌ Scraping failed:', error.message);
    process.exit(1);
  }
}

runScraper();

// Vercel deployment exports
module.exports = async (req, res) => {
  try {
    await runScraper();
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
module.exports.config = { schedule: '@daily' };