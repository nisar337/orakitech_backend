import cloudinary from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary"

cloudinary.v2.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.CLOUD_API_KEY,
    api_secret: process.env.CLOUD_API_SECRET
})


const storage = new CloudinaryStorage({
    cloudinary: cloudinary.v2,
    params: {
        folder: "Orakitech",
        allowed_formats: ["jpg", "png", "jpeg", "webp"]
    }
})


export { cloudinary, storage } 