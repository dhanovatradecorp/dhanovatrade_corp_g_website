import mongoose from "mongoose";
const { Schema, model, models } = mongoose;
const schema = new Schema({
    user: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
        unique: true,
        index: true,
    },
    items: [
        {
            product: {
                type: Schema.Types.ObjectId,
                ref: "Product",
                required: true,
            },
            quantity: { type: Number, required: true, min: 1, max: 99 },
        },
    ],
}, { timestamps: true });
export default models.Cart ||
    model("Cart", schema);
