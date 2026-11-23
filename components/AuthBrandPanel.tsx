import Link from "next/link";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { Carousel } from "antd";

// 背景轮播图素材：public/images/login/ 下，按需增删
const BG_IMAGES = [
  "/images/login/login_banner_dlrb_01.jpeg",
  "/images/login/login_banner_lzm_01.jpg",
];

interface AuthBrandPanelProps {
  /** 面板中央展示的标语文字 */
  slogan: string;
  /** 是否展示右上角"返回首页"链接（登录页展示，注册页不展示） */
  showBackLink?: boolean;
}

/**
 * 认证页（登录/注册/忘记密码）左侧品牌面板：背景图 + 渐变遮罩 + 品牌名 + 标语。
 * 移动端隐藏；文案由 slogan 决定，各页共用同一背景视觉。
 */
export default function AuthBrandPanel({
  slogan,
  showBackLink,
}: AuthBrandPanelProps) {
  return (
    <div className="relative hidden h-screen aspect-3/4 overflow-hidden md:block">
      {/* 背景图轮播：fade 渐隐切换，不显示指示点，避免干扰前景文字 */}
      <Carousel
        autoplay
        autoplaySpeed={5000}
        dots={false}
        effect="fade"
        className="absolute inset-0"
      >
        {BG_IMAGES.map((src) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src} alt="" className="h-full w-full object-fill" />
        ))}
      </Carousel>
      <div className="absolute inset-0 bg-linear-to-t from-black/50 via-black/10 to-black/30" />
      {/* 品牌名/标语叠在照片上，固定用 colorWhite token（不随主题翻转）；返回链接用主题色文本 token */}
      <div className="absolute top-8 left-10 text-2xl font-bold tracking-tight text-(--ant-color-white)">
        CodeBench
      </div>
      {showBackLink && (
        <div className="absolute top-8 right-10">
          <Link href="/">
            <div className="text-(--ant-color-primary-text) hover:text-(--ant-color-primary-text-hover) ">
              <ArrowLeftOutlined />
              <span className="ml-1 ">返回首页</span>
            </div>
          </Link>
        </div>
      )}
      <p className="absolute top-1/2 left-1/2 w-[420px] -translate-x-1/2 -translate-y-1/2 text-center text-3xl leading-relaxed font-medium text-(--ant-color-white)">
        {slogan}
      </p>
    </div>
  );
}
