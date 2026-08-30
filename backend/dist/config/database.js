import mongoose from "mongoose";
export async function connectToDatabase() {
    const uri = 'mongodb+srv://bramesh1011:LovelyRam1011@cluster0.xlxn84y.mongodb.net/?appName=Cluster0';
    if (!uri)
        throw new Error("MONGODB_URI is not configured");
    await mongoose.connect(uri);
    console.log("MongoDB connected");
}
