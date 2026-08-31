import mongoose from "mongoose";
export async function connectToDatabase() {
  try {
    await mongoose.connect(
      "mongodb+srv://dhanovatradecorp_db_user:cZVKMijvUzWe45f6@cluster0.8mhtxec.mongodb.net/?appName=Cluster0",
    );
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    process.exit(1);
  }
}
