/**
 * Script to drop the oldId unique index from the projects collection.
 * Run with: node drop_oldId_index.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function dropOldIdIndex() {
  try {
    await mongoose.connect(process.env.DB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('Connected to MongoDB');
    
    const db = mongoose.connection.db;
    const collection = db.collection('projects');
    
    // List current indexes
    const indexes = await collection.indexes();
    console.log('Current indexes:', indexes.map(i => i.name));
    
    // Check if oldId_1 index exists
    const oldIdIndex = indexes.find(i => i.name === 'oldId_1');
    if (oldIdIndex) {
      console.log('Found oldId_1 index, dropping it...');
      await collection.dropIndex('oldId_1');
      console.log('Successfully dropped oldId_1 index');
    } else {
      console.log('oldId_1 index not found - already removed or named differently');
    }
    
    // List indexes after
    const indexesAfter = await collection.indexes();
    console.log('Indexes after:', indexesAfter.map(i => i.name));
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

dropOldIdIndex();
