import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Starting database seed...')

  // Create sample categories
  const categories = await prisma.category.createMany({
    data: [
      { name: 'Electronics', slug: 'electronics' },
      { name: 'Fashion', slug: 'fashion' },
      { name: 'Home & Garden', slug: 'home-garden' },
      { name: 'Sports & Outdoors', slug: 'sports-outdoors' },
      { name: 'Books', slug: 'books' },
    ],
    skipDuplicates: true,
  })

  console.log(`Created ${categories.count} categories`)

  // Create sample brands using raw SQL for upsert
  await prisma.$executeRaw`
    INSERT INTO "Brand" (id, name, logoUrl, description, productCount) VALUES
    ('1', 'Apple', 'https://example.com/apple-logo.png', 'Innovative technology company', 5),
    ('2', 'Samsung', 'https://example.com/samsung-logo.png', 'Global electronics leader', 8),
    ('3', 'Sony', 'https://example.com/sony-logo.png', 'Entertainment and technology pioneer', 4),
    ('4', 'Nike', 'https://example.com/nike-logo.png', 'Athletic footwear and apparel', 6),
    ('5', 'Adidas', 'https://example.com/adidas-logo.png', 'Sportswear and accessories', 5)
    ON CONFLICT (id) DO NOTHING
  `

  console.log(`Created/updated sample brands`)

  // Get category IDs for product creation
  const [electronics, fashion, home, sports, books] = await prisma.category.findMany({
    select: { id: true },
    where: {
      name: {
        in: ['Electronics', 'Fashion', 'Home & Garden', 'Sports & Outdoors', 'Books']
      }
    }
  })

  // Create sample products
  const products = await prisma.product.createMany({
    data: [
      {
        name: 'Smartphone X1',
        description: 'Latest flagship smartphone with advanced camera system',
        price: 999.99,
        stock: 50,
        imageUrl: 'https://example.com/smartphone.jpg',
        status: 'PUBLISHED',
        sellerId: '1',
        categoryId: electronics.id,
      },
      {
        name: 'Wireless Headphones Pro',
        description: 'Noise-cancelling wireless headphones with 30-hour battery life',
        price: 299.99,
        stock: 30,
        imageUrl: 'https://example.com/headphones.jpg',
        status: 'PUBLISHED',
        sellerId: '1',
        categoryId: electronics.id,
      },
      {
        name: '4K Ultra HD Smart TV',
        description: '55-inch 4K Smart TV with HDR and voice control',
        price: 699.99,
        stock: 15,
        imageUrl: 'https://example.com/tv.jpg',
        status: 'PUBLISHED',
        sellerId: '2',
        categoryId: electronics.id,
      },
      {
        name: "Men's Casual Shirt",
        description: 'Comfortable cotton casual shirt for everyday wear',
        price: 49.99,
        stock: 100,
        imageUrl: 'https://example.com/shirt.jpg',
        status: 'PUBLISHED',
        sellerId: '4',
        categoryId: fashion.id,
      },
      {
        name: "Women's Running Shoes",
        description: 'Lightweight running shoes with responsive cushioning',
        price: 89.99,
        stock: 75,
        imageUrl: 'https://example.com/shoes.jpg',
        status: 'PUBLISHED',
        sellerId: '4',
        categoryId: fashion.id,
      },
      {
        name: 'Coffee Maker Deluxe',
        description: 'Programmable coffee maker with thermal carafe',
        price: 79.99,
        stock: 25,
        imageUrl: 'https://example.com/coffee-maker.jpg',
        status: 'PUBLISHED',
        sellerId: '3',
        categoryId: home.id,
      },
      {
        name: 'Yoga Mat Premium',
        description: 'Non-slip yoga mat with alignment guides',
        price: 24.99,
        stock: 60,
        imageUrl: 'https://example.com/yoga-mat.jpg',
        status: 'PUBLISHED',
        sellerId: '5',
        categoryId: sports.id,
      },
      {
        name: 'Web Development Guide',
        description: 'Comprehensive guide to modern web development',
        price: 39.99,
        stock: 40,
        imageUrl: 'https://example.com/book.jpg',
        status: 'PUBLISHED',
        sellerId: '1',
        categoryId: books.id,
      }
    ],
    skipDuplicates: true,
  })

  console.log(`Created ${products.count} sample products`)

  console.log('Database seeding completed!')
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })