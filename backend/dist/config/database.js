import mongoose from "mongoose";
export async function connectToDatabase() {
  const uri =
    "mongodb+srv://dhanovatradecorp_db_user:cZVKMijvUzWe45f6@cluster0.8mhtxec.mongodb.net/?appName=Cluster0";
  if (!uri) throw new Error("MONGODB_URI is not configured");
  await mongoose.connect(uri);
  console.log("MongoDB connected");
}
