import mongoose from "mongoose";

const aboutContentSchema = new mongoose.Schema(
  {
    heroTitle: { type: String, default: "About Us" },
    heroDescription: { type: String, default: "Welcome to the ultimate destination for your digital lifestyle. We specialize in high-performance laptops and cutting-edge accessories designed to fuel your creativity and boost your productivity. Whether you're a professional seeking efficiency or a creator pushing boundaries, we provide the reliable hardware you need to achieve your vision with total confidence." },
    missionTitle: { type: String, default: "Our Mission" },
    missionDescription: { type: String, default: "Our mission is to provide high-performance laptop gear that empowers users to innovate, improve productivity, and achieve their vision with cutting-edge tech." },
    visionTitle: { type: String, default: "Our Vision" },
    visionDescription: { type: String, default: "Our vision is to become a leading tech provider known for quality, reliability, and delivering exceptional hardware experiences to users worldwide." },
    whyChooseUsTitle: { type: String, default: "Why Choose Us" },
    features: {
      type: [
        {
          title: { type: String, default: "" },
          description: { type: String, default: "" },
        },
      ],
      default: [
        { title: "Modern Design", description: "Clean, modern UI/UX designs tailored for best user experience." },
        { title: "Reliable", description: "We deliver consistent and dependable solutions for your business." },
        { title: "Fast Performance", description: "Optimized applications that ensure speed and scalability." },
      ],
    },
    ctaTitle: { type: String, default: "Want to work with us?" },
    ctaDescription: { type: String, default: "Let's build something amazing together. Reach out to us today." },
  },
  { timestamps: true }
);

// Ensure only one document exists
aboutContentSchema.statics.getSingleton = async function () {
  let content = await this.findOne();
  if (!content) {
    content = await this.create({});
  }
  return content;
};

export default mongoose.model("AboutContent", aboutContentSchema);
