import { InformationPage } from "@/components/content/information-page";
import { informationMetadata } from "@/lib/site-information";
export const generateMetadata = () => informationMetadata("faq");
export default function FaqPage() { return <InformationPage slug="faq" />; }
