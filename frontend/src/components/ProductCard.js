'use client';

import Link from 'next/link';

export default function ProductCard({ product }) {
  return (
    <Link href={`/products/${product.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="product-card animate-fade-in-up">
        <div className="product-card-image-wrapper">
          <img
            src={product.image || '/placeholder.jpg'}
            alt={product.name}
            className="product-card-image"
            loading="lazy"
          />
          {product.category && (
            <span className="product-card-category-badge">{product.category}</span>
          )}
        </div>
        <div className="product-card-body">
          <h3 className="product-card-name">{product.name}</h3>
          <div className="product-card-price-row">
            <span className="product-card-price">
              GH₵{Number(product.price).toFixed(2)}
            </span>
            {product.pack_size > 1 && (
              <span className="product-card-pack-badge">
                Pack of {product.pack_size}
              </span>
            )}
          </div>
          {product.unit_price && product.pack_size > 1 && (
            <div className="product-card-unit-price">
              GH₵{Number(product.unit_price).toFixed(2)} each
            </div>
          )}
          {product.stock !== undefined && (
            <div className={`product-card-stock ${product.stock > 0 ? 'in-stock' : 'out-of-stock'}`}>
              <span className="stock-dot" />
              {product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
