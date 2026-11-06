import { InformationPage } from "@/components/content/information-page";
import { informationMetadata } from "@/lib/site-information";
export const generateMetadata = () => informationMetadata("about");
export default function AboutPage() { return <InformationPage slug="about" />; }
